import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import {
  MIME_PDF,
  MIMES_NEEDING_EXTRACTION,
  SUPPORTED_UPLOAD_MIMES,
  extractText
} from "@/lib/extraction";

const EXTRACTED_CHUNK_SIZE = 10_000;

/**
 * Client-direct upload endpoint. The Vercel Blob client calls this URL twice
 * per upload:
 *   1. Before the upload, to get a signed token (onBeforeGenerateToken).
 *   2. After the upload completes, via a webhook from Vercel's infra
 *      (onUploadCompleted), where we persist the Document row.
 *
 * This path bypasses Vercel's 4.5MB serverless-function body limit — the
 * browser streams directly to Blob storage.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayloadString) => {
        // Only the pre-upload call has a browser session; the completion
        // webhook from Vercel infra does not. We verify identity here and
        // stash it in tokenPayload for onUploadCompleted to trust.
        const session = await auth();
        const userId = session?.user?.id;
        if (!userId) throw new Error("Not signed in.");
        const payload = JSON.parse(clientPayloadString ?? "{}") as {
          workspaceId?: string;
          filename?: string;
          sizeBytes?: number;
        };
        if (!payload.workspaceId || !payload.filename) {
          throw new Error("Missing workspaceId or filename.");
        }

        const [membership, user, workspace] = await Promise.all([
          prisma.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: payload.workspaceId, userId }
            }
          }),
          prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
          prisma.workspace.findUnique({
            where: { id: payload.workspaceId },
            select: { status: true }
          })
        ]);

        if (!workspace) throw new Error("Deal not found.");
        if (workspace.status === "archived") {
          throw new Error("This deal is archived. Unarchive it to upload new files.");
        }

        const isAdmin = user?.role === "admin";
        if (!membership && !isAdmin) {
          throw new Error("No access to this workspace.");
        }
        if (!isAdmin && membership && membership.role === "ic") {
          throw new Error("Only deal-team members can upload files.");
        }

        return {
          allowedContentTypes: [...SUPPORTED_UPLOAD_MIMES],
          maximumSizeInBytes: 32 * 1024 * 1024,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            workspaceId: payload.workspaceId,
            userId,
            filename: payload.filename,
            sizeBytes: payload.sizeBytes ?? 0
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload ?? "{}") as {
          workspaceId: string;
          userId: string;
          filename: string;
          sizeBytes: number;
        };
        const mime = blob.contentType ?? MIME_PDF;
        const needsExtraction = MIMES_NEEDING_EXTRACTION.has(mime);

        const doc = await prisma.document.create({
          data: {
            workspaceId: payload.workspaceId,
            uploadedById: payload.userId,
            filename: payload.filename,
            mimeType: mime,
            sizeBytes: payload.sizeBytes,
            storageKey: blob.url,
            status: needsExtraction ? "processing" : "ready"
          }
        });

        if (needsExtraction) {
          try {
            const res = await fetch(blob.url);
            if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
            const bytes = Buffer.from(await res.arrayBuffer());
            const extracted = await extractText(bytes, mime);

            const chunks: { documentId: string; workspaceId: string; chunkIndex: number; content: string }[] = [];
            for (let i = 0, idx = 0; i < extracted.text.length; i += EXTRACTED_CHUNK_SIZE, idx++) {
              chunks.push({
                documentId: doc.id,
                workspaceId: payload.workspaceId,
                chunkIndex: idx,
                content: extracted.text.slice(i, i + EXTRACTED_CHUNK_SIZE)
              });
            }
            if (chunks.length > 0) {
              await prisma.documentChunk.createMany({ data: chunks });
            }
            await prisma.document.update({
              where: { id: doc.id },
              data: { status: "ready", pageCount: extracted.pageCount }
            });
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            await prisma.document.update({
              where: { id: doc.id },
              data: { status: "failed", statusReason: reason.slice(0, 500) }
            });
          }
        }

        await logAudit({
          actorId: payload.userId,
          action: "document.upload",
          targetType: "document",
          targetId: doc.id,
          workspaceId: payload.workspaceId,
          metadata: { filename: payload.filename, sizeBytes: payload.sizeBytes, mimeType: mime }
        });
      }
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
