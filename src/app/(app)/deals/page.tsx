import Link from "next/link";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export default async function DealsPage({
  searchParams
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const showArchived = params.archived === "1";

  const baseScope =
    user.role === "admin" ? {} : { members: { some: { userId: user.id } } };

  const statusScope = showArchived ? {} : { status: "active" as const };

  const [workspaces, archivedCount] = await Promise.all([
    prisma.workspace.findMany({
      where: { ...baseScope, ...statusScope },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { documents: true, threads: true, members: true } }
      }
    }),
    prisma.workspace.count({
      where: { ...baseScope, status: "archived" }
    })
  ]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
          <p className="text-sm text-slate-600">
            Each deal is an isolated workspace. Only named members see its documents and threads.
          </p>
        </div>
        <Link
          href="/deals/new"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New deal
        </Link>
      </div>

      {archivedCount > 0 ? (
        <div className="mb-4 flex items-center gap-3 text-xs text-slate-600">
          {showArchived ? (
            <>
              <span>Showing active + archived.</span>
              <Link href="/deals" className="underline underline-offset-2 hover:text-slate-900">
                Hide archived
              </Link>
            </>
          ) : (
            <Link
              href="/deals?archived=1"
              className="underline underline-offset-2 hover:text-slate-900"
            >
              Show archived ({archivedCount})
            </Link>
          )}
        </div>
      ) : null}

      {workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-600">
            You don&apos;t have access to any deals yet. Create a new deal or ask a deal-team member
            to add you.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {workspaces.map((w) => {
            const isArchived = w.status === "archived";
            return (
              <li key={w.id}>
                <Link
                  href={`/deals/${w.id}`}
                  className={`block rounded-lg border p-5 hover:shadow-sm ${
                    isArchived
                      ? "border-slate-200 bg-slate-50 hover:border-slate-300"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-medium text-slate-900">{w.name}</span>
                        {isArchived ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                            archived
                          </span>
                        ) : null}
                      </div>
                      {w.dealCode ? (
                        <div className="text-xs text-slate-500">{w.dealCode}</div>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500">{formatDateTime(w.updatedAt)}</div>
                  </div>
                  <div className="mt-4 flex gap-4 text-xs text-slate-600">
                    <span>{w._count.documents} documents</span>
                    <span>{w._count.threads} threads</span>
                    <span>{w._count.members} members</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
