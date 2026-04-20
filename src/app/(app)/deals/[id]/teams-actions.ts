"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManageWorkspace, requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { postToTeams } from "@/lib/teams";

const setSchema = z.object({
  workspaceId: z.string().min(1),
  url: z.string().url().nullable()
});

export async function setTeamsWebhook(input: z.infer<typeof setSchema>): Promise<void> {
  const { workspaceId, url } = setSchema.parse(input);
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can set the Teams webhook.");
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { teamsWebhookUrl: url }
  });

  await logAudit({
    actorId: user.id,
    action: url ? "workspace.teams_webhook.set" : "workspace.teams_webhook.clear",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId
  });

  revalidatePath(`/deals/${workspaceId}`);
}

const testSchema = z.object({ workspaceId: z.string().min(1) });

export async function testTeamsWebhook(
  input: z.infer<typeof testSchema>
): Promise<{ posted: boolean; reason?: string }> {
  const { workspaceId } = testSchema.parse(input);
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can send test messages.");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, dealCode: true }
  });

  return postToTeams(workspaceId, {
    title: `Test message from LKCM IC Bot — ${workspace?.name ?? "deal"}`,
    subtitle: workspace?.dealCode ?? undefined,
    body: "If you can see this, your Teams integration is wired up correctly.",
    accent: "default"
  });
}
