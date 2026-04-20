import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

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

        const [membership, user] = await Promise.all([
          prisma.workspaceMember.findUnique({
            where: {
              workspaceId_userId: { workspaceId: payload.workspaceId, userId }
            }
          }),
          prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
        ]);

        const isAdmin = user?.role === "admin";
        if (!membership && !isAdmin) {
          throw new Error("No access to this workspace.");
        }
        if (!isAdmin && membership && membership.role === "ic") {
          throw new Error("Only deal-team members can upload files.");
        }

        return {
          allowedContentTypes: ["application/pdf"],
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
        const doc = await prisma.document.create({
          data: {
            workspaceId: payload.workspaceId,
            uploadedById: payload.userId,
            filename: payload.filename,
            mimeType: blob.contentType ?? "application/pdf",
            sizeBytes: payload.sizeBytes,
            storageKey: blob.url,
            status: "ready"
          }
        });
        await logAudit({
          actorId: payload.userId,
          action: "document.upload",
          targetType: "document",
          targetId: doc.id,
          workspaceId: payload.workspaceId,
          metadata: { filename: payload.filename, sizeBytes: payload.sizeBytes }
        });
      }
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
