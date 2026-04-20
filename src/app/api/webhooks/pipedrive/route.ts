import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/env";
import { logAudit } from "@/lib/audit";
import { getDeal as getPipedriveDeal, getDealMetadata, dealUrl } from "@/lib/pipedrive";

export const runtime = "nodejs";

/**
 * Pipedrive webhooks. Configure in Pipedrive:
 *   Settings → Tools and integrations → Webhooks → Add new webhook
 *     Event action: *
 *     Event object: deal
 *     Endpoint URL:  https://<this-app>/api/webhooks/pipedrive
 *     HTTP Auth username: pipedrive
 *     HTTP Auth password: <value of PIPEDRIVE_WEBHOOK_SECRET>
 *
 * We react to v1 payloads ({ meta: { action, object }, current, previous }).
 * On any change to a known deal, we refresh the workspace's cached metadata.
 * On a stage change that matches PIPEDRIVE_AUTO_PROVISION_STAGES, we
 * auto-create the workspace if one doesn't already exist.
 */

type V1Payload = {
  meta?: {
    action?: string; // "added" | "updated" | "deleted" | "merged"
    object?: string; // "deal"
    id?: number;
    timestamp?: number;
    webhook_id?: string;
  };
  current?: Record<string, unknown> | null;
  previous?: Record<string, unknown> | null;
};

type V2Payload = {
  event?: string; // e.g. "deal.change"
  data?: { id?: number };
  meta?: { id?: number };
};

function authOk(request: Request): boolean {
  if (!env.PIPEDRIVE_WEBHOOK_SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  const b64 = header.slice(6).trim();
  try {
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");
    // Username is informational; password must match the secret.
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

export async function POST(request: Request): Promise<NextResponse> {
  if (!authOk(request)) {
    // Be terse — don't leak which check failed.
    return new NextResponse("unauthorized", { status: 401 });
  }

  let body: V1Payload & V2Payload;
  try {
    body = (await request.json()) as V1Payload & V2Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  // Extract deal id + action from whichever payload shape arrived.
  const dealId =
    body.meta?.id ??
    body.data?.id ??
    (body.current && typeof (body.current as { id?: number }).id === "number"
      ? ((body.current as { id?: number }).id as number)
      : null);

  const action = body.meta?.action ?? (body.event ? body.event.split(".")[1] : null);
  const object = body.meta?.object ?? (body.event ? body.event.split(".")[0] : null);

  if (!dealId || object !== "deal") {
    // Ack but ignore non-deal events — Pipedrive retries on non-2xx and we
    // don't want noisy retries for stuff we don't handle.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const existing = await prisma.workspace.findUnique({
    where: { pipedriveDealId: dealId }
  });

  // DELETED: archive the workspace so it stops showing in active lists, but
  // don't hard-delete — audit trail is valuable.
  if (action === "deleted") {
    if (existing) {
      await prisma.workspace.update({
        where: { id: existing.id },
        data: { status: "archived" }
      });
      await logAudit({
        actorId: existing.createdById,
        action: "workspace.pipedrive.deleted",
        targetType: "workspace",
        targetId: existing.id,
        workspaceId: existing.id,
        metadata: { pipedriveDealId: dealId }
      });
    }
    return NextResponse.json({ ok: true, action: "archived" });
  }

  // ADDED or UPDATED — pull full detail and metadata.
  let deal;
  let meta;
  try {
    [deal, meta] = await Promise.all([
      getPipedriveDeal(dealId),
      getDealMetadata(dealId).catch(() => null)
    ]);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "pipedrive fetch failed" },
      { status: 502 }
    );
  }
  if (!deal) {
    // Deal might have been deleted between webhook + our fetch; ignore quietly.
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
        // If Pipedrive un-deletes or moves an archived deal back to open, un-archive.
        ...(deal.status === "open" && existing.status === "archived"
          ? { status: "active" as const }
          : {})
      }
    });
    await logAudit({
      actorId: existing.createdById,
      action: "workspace.pipedrive.webhook.sync",
      targetType: "workspace",
      targetId: existing.id,
      workspaceId: existing.id,
      metadata: {
        pipedriveDealId: dealId,
        pipedriveAction: action,
        newStage: deal.stageName
      }
    });
    return NextResponse.json({ ok: true, action: "updated", workspaceId: existing.id });
  }

  // No workspace yet — auto-provision if the deal is in a configured stage.
  const gateStages = autoProvisionStages();
  if (gateStages.size > 0 && deal.stageName && gateStages.has(deal.stageName.toLowerCase())) {
    // Attribute creation to the Pipedrive deal owner if we can find them in
    // our user table; otherwise fall back to the first admin.
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
    await logAudit({
      actorId: creatorId,
      action: "workspace.pipedrive.auto-provisioned",
      targetType: "workspace",
      targetId: workspace.id,
      workspaceId: workspace.id,
      metadata: {
        pipedriveDealId: dealId,
        matchedStage: deal.stageName
      }
    });
    return NextResponse.json({
      ok: true,
      action: "auto-provisioned",
      workspaceId: workspace.id
    });
  }

  // Not a known deal + not in an auto-provision stage — acknowledge and no-op.
  return NextResponse.json({ ok: true, ignored: "unknown deal, no auto-provision stage match" });
}
