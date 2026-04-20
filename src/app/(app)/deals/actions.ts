"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { searchDirectory } from "@/lib/graph";
import {
  getDeal as getPipedriveDeal,
  getDealMetadata,
  dealUrl
} from "@/lib/pipedrive";

const createDealSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dealCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined))
});

export async function createDeal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = createDealSchema.safeParse({
    name: formData.get("name"),
    dealCode: formData.get("dealCode") ?? undefined
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.name,
      dealCode: parsed.data.dealCode,
      createdById: user.id,
      members: {
        create: { userId: user.id, role: "owner" }
      }
    }
  });

  await logAudit({
    actorId: user.id,
    action: "workspace.create",
    targetType: "workspace",
    targetId: workspace.id,
    workspaceId: workspace.id,
    metadata: { name: workspace.name, dealCode: workspace.dealCode }
  });

  revalidatePath("/deals");
  redirect(`/deals/${workspace.id}`);
}

const importSchema = z.object({
  pipedriveDealId: z.coerce.number().int().positive()
});

/**
 * Creates a workspace from a Pipedrive deal. Idempotent on pipedriveDealId —
 * if this deal was already imported, we return the existing workspace URL
 * instead of failing.
 *
 * Auto-adds:
 *   - the current user as owner
 *   - the Pipedrive deal owner (matched by email to an existing User row,
 *     or upserted if the email doesn't exist yet) as an additional owner.
 */
export async function importFromPipedrive(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = importSchema.safeParse({
    pipedriveDealId: formData.get("pipedriveDealId")
  });
  if (!parsed.success) throw new Error("Invalid Pipedrive deal id.");

  // Idempotency: if we already imported this deal, just route there.
  const existing = await prisma.workspace.findUnique({
    where: { pipedriveDealId: parsed.data.pipedriveDealId }
  });
  if (existing) {
    redirect(`/deals/${existing.id}`);
  }

  const [deal, meta] = await Promise.all([
    getPipedriveDeal(parsed.data.pipedriveDealId),
    getDealMetadata(parsed.data.pipedriveDealId).catch(() => null)
  ]);
  if (!deal) throw new Error("Pipedrive deal not found.");

  const url = dealUrl(deal.id);

  const workspace = await prisma.workspace.create({
    data: {
      name: deal.title,
      orgName: deal.orgName,
      stageName: deal.stageName,
      valueCents:
        typeof deal.value === "number" ? BigInt(Math.round(deal.value * 100)) : null,
      currency: deal.currency,
      pipedriveDealId: deal.id,
      pipedriveUrl: url,
      pipedriveMeta: meta ? (meta as unknown as object) : undefined,
      createdById: user.id,
      members: { create: { userId: user.id, role: "owner" } }
    }
  });

  // If the Pipedrive deal has a different owner whose email we recognize,
  // add them as owner too. Best-effort — don't fail the import if this step
  // trips.
  if (deal.ownerEmail && deal.ownerEmail.toLowerCase() !== user.email.toLowerCase()) {
    try {
      const owner = await prisma.user.upsert({
        where: { email: deal.ownerEmail.toLowerCase() },
        update: { name: deal.ownerName ?? undefined },
        create: {
          email: deal.ownerEmail.toLowerCase(),
          name: deal.ownerName ?? undefined,
          role: "member"
        }
      });
      await prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: workspace.id, userId: owner.id } },
        update: { role: "owner" },
        create: { workspaceId: workspace.id, userId: owner.id, role: "owner" }
      });
    } catch {
      // ignore
    }
  }

  await logAudit({
    actorId: user.id,
    action: "workspace.import.pipedrive",
    targetType: "workspace",
    targetId: workspace.id,
    workspaceId: workspace.id,
    metadata: {
      pipedriveDealId: deal.id,
      title: deal.title,
      orgName: deal.orgName,
      stageName: deal.stageName
    }
  });

  revalidatePath("/deals");
  redirect(`/deals/${workspace.id}`);
}

const addMemberSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["owner", "dealteam", "ic"])
});

export async function addMember(formData: FormData): Promise<void> {
  const parsed = addMemberSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role")
  });
  if (!parsed.success) throw new Error("Invalid input");

  const { workspaceId, email, role } = parsed.data;
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (user.role !== "admin" && membership?.role !== "owner" && membership?.role !== "dealteam") {
    throw new Error("Only the deal team can add members.");
  }

  // Best-effort directory lookup so the placeholder row shows a name and
  // entraOid immediately, rather than waiting for the user's first sign-in.
  // Silently falls through if Graph is unavailable or the email isn't found.
  let directoryName: string | undefined;
  let directoryOid: string | undefined;
  try {
    const hits = await searchDirectory(email, 1);
    const match = hits.find(
      (h) => (h.mail ?? "").toLowerCase() === email.toLowerCase()
    );
    if (match) {
      directoryName = match.displayName ?? undefined;
      directoryOid = match.id;
    }
  } catch {
    // ignore — directory lookup is non-critical
  }

  const target = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {
      ...(directoryName ? { name: directoryName } : {}),
      ...(directoryOid ? { entraOid: directoryOid } : {})
    },
    create: {
      email: email.toLowerCase(),
      name: directoryName,
      entraOid: directoryOid,
      role: "member"
    }
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: target.id } },
    update: { role },
    create: { workspaceId, userId: target.id, role }
  });

  await logAudit({
    actorId: user.id,
    action: "workspace.member.add",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { addedEmail: target.email, role }
  });

  revalidatePath(`/deals/${workspaceId}`);
}

/**
 * Refresh the cached Pipedrive metadata for a deal. Updates top-level fields
 * (orgName, stageName, value, currency) and the flexible pipedriveMeta JSON.
 * Anyone with workspace access can refresh.
 */
export async function refreshPipedrive(workspaceId: string): Promise<void> {
  const { user } = await requireWorkspaceAccess(workspaceId);

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { pipedriveDealId: true }
  });
  if (!workspace?.pipedriveDealId) {
    throw new Error("This deal isn't linked to Pipedrive.");
  }

  const [deal, meta] = await Promise.all([
    getPipedriveDeal(workspace.pipedriveDealId),
    getDealMetadata(workspace.pipedriveDealId).catch(() => null)
  ]);
  if (!deal) throw new Error("Pipedrive deal not found. It may have been deleted.");

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      name: deal.title,
      orgName: deal.orgName,
      stageName: deal.stageName,
      valueCents:
        typeof deal.value === "number" ? BigInt(Math.round(deal.value * 100)) : null,
      currency: deal.currency,
      pipedriveMeta: meta ? (meta as unknown as object) : undefined
    }
  });

  await logAudit({
    actorId: user.id,
    action: "workspace.pipedrive.refresh",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { pipedriveDealId: workspace.pipedriveDealId }
  });

  revalidatePath(`/deals/${workspaceId}`);
}
