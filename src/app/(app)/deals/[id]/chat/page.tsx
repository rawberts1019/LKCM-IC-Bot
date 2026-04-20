import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { formatDateTime } from "@/lib/utils";

export default async function ChatPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ thread?: string }>;
}) {
  const { id } = await params;
  const { thread: threadId } = await searchParams;
  const { user } = await requireWorkspaceAccess(id);

  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) notFound();

  // Threads are per-user within a deal workspace. Deal team sees all threads
  // for their deal; IC members see only their own.
  const threads = await prisma.thread.findMany({
    where: { workspaceId: id, createdById: user.id },
    orderBy: { updatedAt: "desc" },
    take: 20
  });

  const activeThread = threadId
    ? await prisma.thread.findFirst({
        where: { id: threadId, workspaceId: id },
        include: {
          messages: { orderBy: { createdAt: "asc" } }
        }
      })
    : null;

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
                  <div className="text-xs text-slate-500">{formatDateTime(t.updatedAt)}</div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </aside>

      <section className="col-span-12 md:col-span-8 lg:col-span-9">
        <div className="flex h-[calc(100vh-12rem)] flex-col rounded-lg border border-slate-200 bg-white">
          <div className="flex-1 overflow-y-auto p-6">
            {!activeThread ? (
              <EmptyChatState />
            ) : activeThread.messages.length === 0 ? (
              <EmptyChatState />
            ) : (
              <ul className="space-y-5">
                {activeThread.messages.map((m) => (
                  <li key={m.id} className="flex flex-col gap-1">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {m.role === "user" ? "You" : m.role === "dealteam" ? "Deal team" : "IC Bot"}
                    </div>
                    <div className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">
                      {m.content}
                    </div>
                    {m.status === "queued" ? (
                      <div className="text-xs text-amber-700">
                        The deal team is reviewing this — you'll get an answer shortly.
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            {/* Week 2: wire to server action that runs retrieval + Claude + confidence routing */}
            <form className="flex gap-2" action="#">
              <input
                name="q"
                placeholder="Ask about this deal..."
                disabled
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button
                type="submit"
                disabled
                className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500"
              >
                Send
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-500">
              Chat is wired in week 2 once documents can be ingested and Claude is reachable.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyChatState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500">
      <div className="max-w-sm">
        <p className="font-medium text-slate-700">Ask anything about this deal.</p>
        <p className="mt-2">
          Answers cite the source documents the deal team uploaded. Low-confidence or
          sensitive questions are routed to the deal team for review.
        </p>
      </div>
    </div>
  );
}
