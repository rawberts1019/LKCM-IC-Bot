import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (session?.user) redirect(params.from ?? "/deals");

  async function doSignIn() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: params.from ?? "/deals" });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            LKCM
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Investment Committee Bot
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your LKCM Microsoft account.
          </p>
        </div>

        {params.error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Sign-in failed. Please try again or contact the CTO.
          </div>
        ) : null}

        <form action={doSignIn}>
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
          >
            Sign in with Microsoft
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-500">
          Access is restricted to authorized LKCM employees. All activity is logged.
        </p>
      </div>
    </main>
  );
}
