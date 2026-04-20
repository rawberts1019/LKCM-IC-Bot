"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { logAudit } from "@/lib/audit";

/**
 * The upload server action is intentionally gone — files now go browser-direct
 * to Vercel Blob via /api/upload/handle, which side-steps Vercel's 4.5MB
 * serverless function body limit. See src/app/api/upload/handle/route.ts and
 * src/app/(app)/deals/[id]/upload/upload-form.tsx.
 */

export async function deleteDocument(workspaceId: string, documentId: string): Promise<void> {
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can delete files.");
  }

  const doc = await prisma.document.findFirst({ where: { id: documentId, workspaceId } });
  if (!doc) throw new Error("Document not found.");

  await prisma.documentChunk.deleteMany({ where: { documentId } });
  await prisma.document.delete({ where: { id: documentId } });

  await logAudit({
    actorId: user.id,
    action: "document.delete",
    targetType: "document",
    targetId: documentId,
    workspaceId,
    metadata: { filename: doc.filename }
  });

  revalidatePath(`/deals/${workspaceId}`);
  revalidatePath(`/deals/${workspaceId}/upload`);
}
