import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/env";
import { logAudit } from "@/lib/audit";
import { getDeal as getPipedriveDeal, getDealMetadata, dealUrl } from "@/lib/pipedrive";

export const runtime = "nodejs";

/**
 * Pipedrive webhooks. Configure in Pipedrive:
 *   Settings → Tools and integrations → Webhooks → Add new webhook
 *     Event action: *                  (or: create + change + delete)
 *     Event object/entity: deal
 *     Endpoint URL:  https://<this-app>/api/webhooks/pipedrive
 *     HTTP Auth username: pipedrive
 *     HTTP Auth password: <value of PIPEDRIVE_WEBHOOK_SECRET>
 *
 * Handles both webhook formats:
 *   v1.x: meta.object = "deal",   meta.action = "added|updated|deleted",
 *         meta.id = <deal id>
 *   v2.0: meta.entity = "deal",   meta.action = "create|change|delete",
 *         meta.entity_id = <deal id>, data = deal object
 */

type AnyPayload = {
  meta?: {
    action?: string;
    object?: string;
    entity?: string;
    id?: number | string;
    entity_id?: number | string;
    version?: string;
    webhook_id?: string;
  };
  event?: string;
  current?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
};

function authOk(request: Request): boolean {
  if (!env.PIPEDRIVE_WEBHOOK_SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  const b64 = header.slice(6).trim();
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");
    return user === "pipedrive" && pass === env.PIPEDRIVE_WEBHOOK_SECRET;
  } catch {
    return false;
  }
}

function autoProvisionStages(): Set<string> {
  return new Set(
    env.PIPEDRIVE_AUTO_PROVISION_STAGES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.toLowerCase())
  );
}

/**
 * Normalize v1 + v2 Pipedrive webhook payloads into a single shape.
 * Returns null if we can't tell it's a deal event.
 */
function normalize(body: AnyPayload): { action: "added" | "updated" | "deleted"; dealId: number } | null {
  const entity = body.meta?.entity ?? body.meta?.object ?? null;
  if (entity !== "deal") return null;

  const rawId = body.meta?.entity_id ?? body.meta?.id;
  const dealId = typeof rawId === "number" ? rawId : rawId ? parseInt(String(rawId), 10) : null;
  if (!dealId || isNaN(dealId)) return null;

  const rawAction = (body.meta?.action ?? "").toLowerCase();
  // v1: added / updated / deleted / merged
  // v2: create / change / delete
  const action: "added" | "updated" | "deleted" =
    rawAction === "added" || rawAction === "create"
      ? "added"
      : rawAction === "deleted" || rawAction === "delete"
        ? "deleted"
        : "updated";
  return { action, dealId };
}

/**
 * Persist a short-lived audit entry for every webhook arrival so /admin/audit
 * shows a live trail of what's happening. Never throws.
 */
async function tryLog(options: {
  action: string;
  workspaceId?: string;
  actorId?: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    let actorId = options.actorId;
    if (!actorId) {
      const fallback = await prisma.user.findFirst({
        where: { role: "admin" },
        select: { id: true }
      });
      actorId = fallback?.id;
    }
    if (!actorId) return; // no admin yet → skip logging (rare, bootstrap only)
    await logAudit({
      actorId,
      action: options.action,
      targetType: "pipedrive-webhook",
      workspaceId: options.workspaceId,
      metadata: options.metadata
    });
  } catch {
    // best-effort; don't fail the webhook on an audit insert issue
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authOk(request)) {
    return new NextResponse("unauthorized", { status: 401 });
  }

  let body: AnyPayload;
  try {
    body = (await request.json()) as AnyPayload;
  } catch {
    await tryLog({
      action: "pipedrive.webhook.bad_json",
      metadata: { note: "payload was not valid JSON" }
    });
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const normalized = normalize(body);
  if (!normalized) {
    await tryLog({
      action: "pipedrive.webhook.ignored",
      metadata: {
        note: "not a deal event",
        version: body.meta?.version ?? "unknown",
        entity: body.meta?.entity ?? body.meta?.object ?? null,
        action: body.meta?.action ?? null
      }
    });
    return NextResponse.json({ ok: true, ignored: "not a deal event" });
  }

  const { action, dealId } = normalized;
  const existing = await prisma.workspace.findUnique({
    where: { pipedriveDealId: dealId }
  });

  // DELETED → archive the linked workspace so the audit trail survives.
  if (action === "deleted") {
    if (existing) {
      await prisma.workspace.update({
        where: { id: existing.id },
        data: { status: "archived" }
      });
      await tryLog({
        action: "pipedrive.webhook.archived",
        workspaceId: existing.id,
        actorId: existing.createdById,
        metadata: { pipedriveDealId: dealId }
      });
    } else {
      await tryLog({
        action: "pipedrive.webhook.ignored",
        metadata: { note: "deleted event for unknown deal", pipedriveDealId: dealId }
      });
    }
    return NextResponse.json({ ok: true, action: "archived" });
  }

  // ADDED / UPDATED → fetch full detail + resolve custom fields.
  let deal;
  let meta;
  try {
    [deal, meta] = await Promise.all([
      getPipedriveDeal(dealId),
      getDealMetadata(dealId).catch(() => null)
    ]);
  } catch (e) {
    await tryLog({
      action: "pipedrive.webhook.error",
      workspaceId: existing?.id,
      actorId: existing?.createdById,
      metadata: {
        pipedriveDealId: dealId,
        error: e instanceof Error ? e.message : "pipedrive fetch failed"
      }
    });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "pipedrive fetch failed" },
      { status: 502 }
    );
  }
  if (!deal) {
    await tryLog({
      action: "pipedrive.webhook.ignored",
      workspaceId: existing?.id,
      actorId: existing?.createdById,
      metadata: { pipedriveDealId: dealId, note: "deal not found on fetch" }
    });
    return NextResponse.json({ ok: true, ignored: "deal not found on fetch" });
  }

  if (existing) {
    await prisma.workspace.update({
      where: { id: existing.id },
      data: {
        name: deal.title,
        orgName: deal.orgName,
        stageName: deal.stageName,
        valueCents:
          typeof deal.value === "number" ? BigInt(Math.round(deal.value * 100)) : null,
        currency: deal.currency,
        pipedriveMeta: meta ? (meta as unknown as object) : undefined,
        ...(deal.status === "open" && existing.status === "archived"
          ? { status: "active" as const }
          : {})
      }
    });
    await tryLog({
      action: "pipedrive.webhook.sync",
      workspaceId: existing.id,
      actorId: existing.createdById,
      metadata: {
        pipedriveDealId: dealId,
        action,
        newStage: deal.stageName,
        version: body.meta?.version ?? "v1"
      }
    });
    return NextResponse.json({ ok: true, action: "updated", workspaceId: existing.id });
  }

  // No workspace yet — auto-provision iff deal is in a configured stage.
  const gateStages = autoProvisionStages();
  if (gateStages.size > 0 && deal.stageName && gateStages.has(deal.stageName.toLowerCase())) {
    let creatorId: string | null = null;
    if (deal.ownerEmail) {
      const user = await prisma.user.findUnique({
        where: { email: deal.ownerEmail.toLowerCase() },
        select: { id: true }
      });
      if (user) creatorId = user.id;
    }
    if (!creatorId) {
      const admin = await prisma.user.findFirst({ where: { role: "admin" } });
      creatorId = admin?.id ?? null;
    }
    if (!creatorId) {
      await tryLog({
        action: "pipedrive.webhook.error",
        metadata: {
          pipedriveDealId: dealId,
          error: "no user to own auto-provisioned workspace"
        }
      });
      return NextResponse.json(
        { ok: false, error: "no user to own auto-provisioned workspace" },
        { status: 500 }
      );
    }

    const workspace = await prisma.workspace.create({
      data: {
        name: deal.title,
        orgName: deal.orgName,
        stageName: deal.stageName,
        valueCents:
          typeof deal.value === "number" ? BigInt(Math.round(deal.value * 100)) : null,
        currency: deal.currency,
        pipedriveDealId: deal.id,
        pipedriveUrl: dealUrl(deal.id),
        pipedriveMeta: meta ? (meta as unknown as object) : undefined,
        createdById: creatorId,
        members: { create: { userId: creatorId, role: "owner" } }
      }
    });
    await tryLog({
      action: "pipedrive.webhook.auto-provisioned",
      workspaceId: workspace.id,
      actorId: creatorId,
      metadata: { pipedriveDealId: dealId, matchedStage: deal.stageName }
    });
    return NextResponse.json({
      ok: true,
      action: "auto-provisioned",
      workspaceId: workspace.id
    });
  }

  await tryLog({
    action: "pipedrive.webhook.ignored",
    metadata: {
      pipedriveDealId: dealId,
      note: "unknown deal + no auto-provision stage match",
      stage: deal.stageName,
      configuredStages: Array.from(gateStages)
    }
  });
  return NextResponse.json({
    ok: true,
    ignored: "unknown deal, no auto-provision stage match"
  });
}
