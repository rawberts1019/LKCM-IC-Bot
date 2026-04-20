import Link from "next/link";
import { signOut } from "@/auth";
import { requireUser } from "@/lib/access";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  async function doSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link href="/deals" className="flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                LKCM
              </span>
              <span className="text-sm font-semibold text-slate-900">IC Bot</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/deals" className="text-slate-700 hover:text-slate-900">
                Deals
              </Link>
              {user.role === "admin" ? (
                <Link href="/admin" className="text-slate-700 hover:text-slate-900">
                  Admin
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{user.email}</span>
            <form action={doSignOut}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
