"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { putObject, storageKeyForDocument } from "@/lib/storage";

const MAX_SIZE_BYTES = 32 * 1024 * 1024; // Anthropic PDF limit; larger docs need chunking
const SUPPORTED_MIMES = new Set([
  "application/pdf"
  // DOCX / PPTX / XLSX handlers land next commit; rejecting for now gives a
  // clearer error than letting Claude try to read them.
]);

export async function uploadDocuments(workspaceId: string, formData: FormData): Promise<void> {
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can upload files.");
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new Error("No files selected.");

  for (const file of files) {
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error(
        `${file.name} is ${Math.round(file.size / 1024 / 1024)} MB. Max per file is 32 MB for now.`
      );
    }
    if (!SUPPORTED_MIMES.has(file.type)) {
      throw new Error(
        `${file.name}: ${file.type || "unknown type"} isn't supported yet. PDFs only in this build — DOCX/PPTX/XLSX next.`
      );
    }
  }

  for (const file of files) {
    // Create the document row first so we have a stable id for the storage key.
    const doc = await prisma.document.create({
      data: {
        workspaceId,
        uploadedById: user.id,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        status: "uploaded",
        storageKey: "" // filled in after upload completes
      }
    });

    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const key = storageKeyForDocument(workspaceId, doc.id, file.name);
      const { storageKey } = await putObject(key, bytes, file.type);

      // PDFs are ready immediately — Claude reads them natively via the
      // Messages API's document content block. No extraction step.
      await prisma.document.update({
        where: { id: doc.id },
        data: { storageKey, status: "ready" }
      });

      await logAudit({
        actorId: user.id,
        action: "document.upload",
        targetType: "document",
        targetId: doc.id,
        workspaceId,
        metadata: { filename: file.name, sizeBytes: file.size }
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "failed", statusReason: message.slice(0, 500) }
      });
      throw e;
    }
  }

  revalidatePath(`/deals/${workspaceId}`);
  revalidatePath(`/deals/${workspaceId}/upload`);
}

export async function deleteDocument(workspaceId: string, documentId: string): Promise<void> {
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (!canManageWorkspace(membership?.role, user.role)) {
    throw new Error("Only deal-team members can delete files.");
  }

  const doc = await prisma.document.findFirst({ where: { id: documentId, workspaceId } });
  if (!doc) throw new Error("Document not found.");

  // Soft-handling: we only blow away the DB row here. The blob stays; a
  // nightly sweeper can prune orphans. Keeps UI snappy and avoids double-prompt
  // delete flows for the prototype.
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
