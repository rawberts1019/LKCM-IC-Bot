"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const approveSchema = z.object({
  messageId: z.string().min(1),
  editedContent: z.string().trim().min(1).optional()
});

export async function approveAnswer(workspaceId: string, formData: FormData): Promise<void> {
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can resolve review items.");
  }

  const parsed = approveSchema.safeParse({
    messageId: formData.get("messageId"),
    editedContent: formData.get("editedContent") || undefined
  });
  if (!parsed.success) throw new Error("Invalid input");

  const message = await prisma.message.findFirst({
    where: { id: parsed.data.messageId, thread: { workspaceId } },
    include: { reviewItem: true }
  });
  if (!message) throw new Error("Message not found");
  if (message.status !== "queued") throw new Error("Message is not pending review.");

  await prisma.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: message.id },
      data: {
        status: "sent",
        ...(parsed.data.editedContent ? { content: parsed.data.editedContent } : {})
      }
    });
    if (message.reviewItem) {
      await tx.reviewQueueItem.update({
        where: { id: message.reviewItem.id },
        data: { status: "resolved", assignedToId: user.id, resolvedAt: new Date() }
      });
    }
  });

  await logAudit({
    actorId: user.id,
    action: parsed.data.editedContent ? "review.approve.edited" : "review.approve",
    targetType: "message",
    targetId: message.id,
    workspaceId,
    metadata: { threadId: message.threadId }
  });

  revalidatePath(`/deals/${workspaceId}/review`);
  revalidatePath(`/deals/${workspaceId}/chat`);
  revalidatePath(`/deals/${workspaceId}`);
}

const replySchema = z.object({
  messageId: z.string().min(1),
  content: z.string().trim().min(2).max(8000)
});

export async function replyOnTop(workspaceId: string, formData: FormData): Promise<void> {
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can reply on top of answers.");
  }

  const parsed = replySchema.safeParse({
    messageId: formData.get("messageId"),
    content: formData.get("content")
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const message = await prisma.message.findFirst({
    where: { id: parsed.data.messageId, thread: { workspaceId } },
    include: { reviewItem: true, thread: true }
  });
  if (!message) throw new Error("Message not found");

  await prisma.$transaction(async (tx) => {
    // Supersede the bot's queued draft so only the deal-team reply shows in the thread.
    await tx.message.update({
      where: { id: message.id },
      data: { status: "superseded" }
    });
    await tx.message.create({
      data: {
        threadId: message.threadId,
        role: "dealteam",
        status: "sent",
        content: parsed.data.content,
        createdById: user.id
      }
    });
    if (message.reviewItem) {
      await tx.reviewQueueItem.update({
        where: { id: message.reviewItem.id },
        data: { status: "resolved", assignedToId: user.id, resolvedAt: new Date() }
      });
    }
    await tx.thread.update({
      where: { id: message.threadId },
      data: { updatedAt: new Date() }
    });
  });

  await logAudit({
    actorId: user.id,
    action: "review.reply",
    targetType: "message",
    targetId: message.id,
    workspaceId,
    metadata: { threadId: message.threadId }
  });

  revalidatePath(`/deals/${workspaceId}/review`);
  revalidatePath(`/deals/${workspaceId}/chat`);
  revalidatePath(`/deals/${workspaceId}`);
}
