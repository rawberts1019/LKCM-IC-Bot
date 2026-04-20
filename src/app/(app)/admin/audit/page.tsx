import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export default async function AuditLogPage() {
  await requireAdmin();

  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      actor: { select: { email: true } },
      workspace: { select: { name: true, dealCode: true } }
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">
          Append-only. Showing the last 200 entries.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Actor</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Target</th>
              <th className="px-4 py-2 text-left">Deal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                  {formatDateTime(r.createdAt)}
                </td>
                <td className="px-4 py-2 text-slate-800">{r.actor?.email ?? "system"}</td>
                <td className="px-4 py-2 font-medium text-slate-900">{r.action}</td>
                <td className="px-4 py-2 text-slate-600">
                  {r.targetType ?? "—"}
                  {r.targetId ? ` / ${r.targetId.slice(0, 8)}` : ""}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.workspace ? r.workspace.dealCode ?? r.workspace.name : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No audit entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
