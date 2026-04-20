import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export default async function AdminHome() {
  await requireAdmin();

  const [userCount, workspaceCount, recentAudit] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count({ where: { status: "active" } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { email: true } } }
    })
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-600">
          Firm-wide view. Manage users, audit activity, inspect workspaces.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <Link
          href="/admin/users"
          className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Users</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{userCount}</div>
        </Link>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Active deals
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{workspaceCount}</div>
        </div>
        <Link
          href="/admin/audit"
          className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Audit log</div>
          <div className="mt-1 text-sm text-slate-700">Every Q&amp;A, upload, and admin action.</div>
        </Link>
        <Link
          href="/admin/integrations"
          className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Integrations
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Pipedrive, webhooks, auto-provision config.
          </div>
        </Link>
        <Link
          href="/admin/usage"
          className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-300"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Cost &amp; usage
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Anthropic spend, per-deal volume, feedback signal.
          </div>
        </Link>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent activity
        </h2>
        {recentAudit.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
            No activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {recentAudit.map((row) => (
              <li key={row.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{row.action}</div>
                  <div className="text-xs text-slate-500">
                    {row.actor?.email ?? "system"} · {formatDateTime(row.createdAt)}
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {row.targetType}
                  {row.targetId ? ` / ${row.targetId.slice(0, 8)}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
