import Link from "next/link";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export default async function DealsPage() {
  const user = await requireUser();

  const workspaces = await prisma.workspace.findMany({
    where:
      user.role === "admin"
        ? { status: "active" }
        : { status: "active", members: { some: { userId: user.id } } },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { documents: true, threads: true, members: true } }
    }
  });

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

      {workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-600">
            You don't have access to any deals yet. Create a new deal or ask a deal-team member to add
            you.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link
                href={`/deals/${w.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-base font-medium text-slate-900">{w.name}</div>
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
          ))}
        </ul>
      )}
    </div>
  );
}
