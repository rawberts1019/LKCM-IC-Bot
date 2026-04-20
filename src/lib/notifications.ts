import { prisma } from "@/lib/db";

export type NotificationType = "answer.ready" | "answer.reply" | "review.new";

type CreateInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  targetUrl: string;
  workspaceId?: string;
};

export async function createNotification(input: CreateInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      targetUrl: input.targetUrl,
      workspaceId: input.workspaceId
    }
  });
}

export async function createNotifications(inputs: CreateInput[]) {
  if (inputs.length === 0) return;
  await prisma.notification.createMany({
    data: inputs.map((i) => ({
      userId: i.userId,
      type: i.type,
      title: i.title,
      body: i.body,
      targetUrl: i.targetUrl,
      workspaceId: i.workspaceId
    }))
  });
}

export async function unreadCountForUser(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null }
  });
}

export async function listForUser(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { workspace: { select: { name: true, dealCode: true } } }
  });
}

/**
 * Returns the IDs of deal-team members (owner + dealteam) for a workspace.
 * Used to fan out a review-queue notification when an asker's question gets
 * queued for human review.
 */
export async function dealTeamMemberIds(workspaceId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, role: { in: ["owner", "dealteam"] } },
    select: { userId: true }
  });
  return rows.map((r) => r.userId);
}
