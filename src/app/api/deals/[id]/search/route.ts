import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";

/**
 * Search threads and messages inside a workspace. Case-insensitive substring
 * match on thread title + message content. Returns up to 20 threads with a
 * snippet of the first matching message.
 *
 * Access is workspace-scoped. IC-only members are limited to their own threads
 * just like the chat list.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id: workspaceId } = await params;
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  const canSeeAll = canManageWorkspace(membership?.role, user.role);

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ threads: [] });

  const threadScope = canSeeAll
    ? { workspaceId }
    : { workspaceId, createdById: user.id };

  const threads = await prisma.thread.findMany({
    where: {
      ...threadScope,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        {
          messages: {
            some: {
              content: { contains: q, mode: "insensitive" },
              status: { not: "superseded" }
            }
          }
        }
      ]
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      messages: {
        where: {
          content: { contains: q, mode: "insensitive" },
          status: { not: "superseded" }
        },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { role: true, content: true }
      }
    }
  });

  return NextResponse.json({
    threads: threads.map((t) => {
      const hit = t.messages[0];
      let snippet: string | null = null;
      if (hit) {
        const idx = hit.content.toLowerCase().indexOf(q.toLowerCase());
        const start = Math.max(0, idx - 40);
        const end = Math.min(hit.content.length, idx + q.length + 80);
        snippet =
          (start > 0 ? "…" : "") +
          hit.content.slice(start, end).replace(/\s+/g, " ").trim() +
          (end < hit.content.length ? "…" : "");
      }
      return {
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt.toISOString(),
        snippet,
        snippetRole: hit?.role ?? null
      };
    })
  });
}
