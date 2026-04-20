import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { formatDateTime } from "@/lib/utils";
import { Composer } from "./composer";

// Claude PDF reads can take 20-40s on a full IC packet; give server actions
// invoked from this route the full Vercel function budget.
export const maxDuration = 60;

export default async function ChatPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { id } = await params;
  const { thread: threadId } = await searchParams;
  const { user, membership } = await requireWorkspaceAccess(id);

  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) notFound();

  const canManage = user.role === "admin" || membership?.role === "owner" || membership?.role === "dealteam";

  // Deal-team members see all threads for their deal; IC members see only their own.
  const threads = await prisma.thread.findMany({
    where: canManage ? { workspaceId: id } : { workspaceId: id, createdById: user.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    include: { createdBy: { select: { email: true, name: true } } }
  });

  const activeThread = threadId
    ? await prisma.thread.findFirst({
        where: {
          id: threadId,
          workspaceId: id,
          ...(canManage ? {} : { createdById: user.id })
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            where: { status: { not: "superseded" } }
          }
        }
      })
    : null;

  const documentsReady = await prisma.document.count({
    where: { workspaceId: id, status: "ready" }
  });

  return (
    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 md:col-span-4 lg:col-span-3">
        <Link href={`/deals/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
          &larr; {workspace.name}
        </Link>
        <div className="mt-3 mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Threads</h2>
          <Link
            href={`/deals/${id}/chat`}
            className="text-xs font-medium text-slate-700 hover:text-slate-900"
          >
            + New
          </Link>
        </div>
        <ul className="space-y-1">
          {threads.length === 0 ? (
            <li className="rounded-md border border-dashed border-slate-300 bg-white p-4 text-center text-xs text-slate-500">
              No threads yet.
            </li>
          ) : (
            threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/deals/${id}/chat?thread=${t.id}`}
                  className={`block rounded-md border px-3 py-2 text-sm ${
                    t.id === threadId
                      ? "border-slate-400 bg-white"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="truncate font-medium text-slate-900">
                    {t.title ?? "Untitled"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {canManage && t.createdById !== user.id ? (
                      <span>{t.createdBy.name ?? t.createdBy.email} · </span>
                    ) : null}
                    {formatDateTime(t.updatedAt)}
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="col-span-12 md:col-span-8 lg:col-span-9">
        <div className="flex h-[calc(100vh-10rem)] flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex-1 overflow-y-auto p-6">
            {!activeThread || activeThread.messages.length === 0 ? (
              <EmptyChatState documentsReady={documentsReady} />
            ) : (
              <ul className="space-y-5">
                {activeThread.messages.map((m) => {
                  const sources =
                    (m.citationsJson as { sources?: Array<{ filename: string; page?: number }> } | null)
                      ?.sources ?? [];
                  return (
                    <li key={m.id} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        <span>
                          {m.role === "user"
                            ? "You"
                            : m.role === "dealteam"
                              ? "Deal team"
                              : "IC Bot"}
                        </span>
                        {m.status === "queued" ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Under review
                          </span>
                        ) : null}
                        {m.confidence !== null && m.confidence !== undefined && m.role === "assistant" ? (
                          <span className="text-xs text-slate-400">
                            conf {(m.confidence * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={`whitespace-pre-wrap rounded-lg border p-3 text-sm ${
                          m.role === "user"
                            ? "border-slate-200 bg-slate-50 text-slate-900"
                            : m.role === "dealteam"
                              ? "border-indigo-200 bg-indigo-50 text-slate-900"
                              : "border-slate-200 bg-white text-slate-900"
                        }`}
                      >
                        {m.content}
                      </div>
                      {sources.length > 0 && m.role === "assistant" ? (
                        <details className="mt-1 text-xs text-slate-600">
                          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                            {sources.length} source{sources.length === 1 ? "" : "s"}
                          </summary>
                          <ul className="mt-1 space-y-1 pl-3">
                            {sources.map((s, i) => (
                              <li key={i}>
                                <span className="font-medium">{s.filename}</span>
                                {s.page ? `, page ${s.page}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {m.status === "queued" ? (
                        <div className="text-xs text-amber-700">
                          {canManage
                            ? "This answer is in the review queue — approve or override it there."
                            : "The deal team is reviewing this — you'll get an answer shortly."}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <Composer
              workspaceId={id}
              threadId={activeThread?.id}
              documentsReady={documentsReady}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyChatState({ documentsReady }: { documentsReady: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
      <div className="max-w-md">
        <p className="font-medium text-slate-700">Ask anything about this deal.</p>
        <p className="mt-2">
          Claude reads all uploaded documents to answer. Answers cite the files they came from.
          Low-confidence or sensitive questions are routed to the deal team for review before the
          asker sees them.
        </p>
        {documentsReady === 0 ? (
          <p className="mt-3 text-amber-700">
            No documents ready yet. Upload something first.
          </p>
        ) : (
          <p className="mt-3 text-slate-400">
            {documentsReady} document{documentsReady === 1 ? "" : "s"} loaded.
          </p>
        )}
      </div>
    </div>
  );
}
