"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const pinSchema = z.object({
  workspaceId: z.string().min(1),
  messageId: z.string().min(1)
});

/**
 * Toggle whether an answer is pinned to the deal's Pinned Answers section.
 * Anyone with workspace access can pin — analysts curate, partners read.
 */
export async function togglePin(input: z.infer<typeof pinSchema>): Promise<{ pinnedAt: string | null }> {
  const { workspaceId, messageId } = pinSchema.parse(input);
  const { user } = await requireWorkspaceAccess(workspaceId);

  const msg = await prisma.message.findFirst({
    where: { id: messageId, thread: { workspaceId } },
    select: { id: true, pinnedAt: true, role: true }
  });
  if (!msg) throw new Error("Message not found.");
  if (msg.role === "user") throw new Error("Pin an answer, not a question.");

  const now = new Date();
  const nextPinnedAt = msg.pinnedAt ? null : now;

  await prisma.message.update({
    where: { id: msg.id },
    data: { pinnedAt: nextPinnedAt }
  });

  await logAudit({
    actorId: user.id,
    action: nextPinnedAt ? "message.pin" : "message.unpin",
    targetType: "message",
    targetId: msg.id,
    workspaceId
  });

  revalidatePath(`/deals/${workspaceId}`);
  revalidatePath(`/deals/${workspaceId}/chat`);
  return { pinnedAt: nextPinnedAt ? nextPinnedAt.toISOString() : null };
}

const voteSchema = z.object({
  workspaceId: z.string().min(1),
  messageId: z.string().min(1),
  vote: z.enum(["up", "down"])
});

/**
 * Record or toggle-off a user's up/down vote on an answer. Voting the same
 * direction twice clears the vote; voting the opposite direction replaces it.
 */
export async function voteOnMessage(
  input: z.infer<typeof voteSchema>
): Promise<{ userVote: "up" | "down" | null; upCount: number; downCount: number }> {
  const { workspaceId, messageId, vote } = voteSchema.parse(input);
  const { user } = await requireWorkspaceAccess(workspaceId);

  const existing = await prisma.messageFeedback.findUnique({
    where: { messageId_userId: { messageId, userId: user.id } }
  });

  if (existing && existing.vote === vote) {
    await prisma.messageFeedback.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.messageFeedback.update({
      where: { id: existing.id },
      data: { vote }
    });
  } else {
    await prisma.messageFeedback.create({
      data: { messageId, userId: user.id, vote }
    });
  }

  const [userVote, counts] = await Promise.all([
    prisma.messageFeedback.findUnique({
      where: { messageId_userId: { messageId, userId: user.id } },
      select: { vote: true }
    }),
    prisma.messageFeedback.groupBy({
      by: ["vote"],
      where: { messageId },
      _count: { _all: true }
    })
  ]);

  const up = counts.find((c) => c.vote === "up")?._count._all ?? 0;
  const down = counts.find((c) => c.vote === "down")?._count._all ?? 0;

  return {
    userVote: (userVote?.vote as "up" | "down" | null) ?? null,
    upCount: up,
    downCount: down
  };
}
