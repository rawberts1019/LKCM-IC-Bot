import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { setUserRole } from "./actions";

export default async function AdminUsersPage() {
  await requireAdmin();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { memberships: true } } }
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-600">
          Accounts are created on first SSO sign-in. Admins can promote or demote from here.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Deals</th>
              <th className="px-4 py-2 text-left">Joined</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-slate-900">{u.email}</td>
                <td className="px-4 py-2 text-slate-700">{u.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">{u._count.memberships}</td>
                <td className="px-4 py-2 text-slate-600">{formatDateTime(u.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <form action={setUserRole} className="inline">
                    <input type="hidden" name="userId" value={u.id} />
                    <input
                      type="hidden"
                      name="role"
                      value={u.role === "admin" ? "member" : "admin"}
                    />
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {u.role === "admin" ? "Demote" : "Make admin"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
