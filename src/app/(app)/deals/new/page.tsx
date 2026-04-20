import Link from "next/link";
import { requireUser } from "@/lib/access";
import { isPipedriveConfigured } from "@/lib/pipedrive";
import { createDeal } from "../actions";
import { PipedrivePicker } from "./pipedrive-picker";

export default async function NewDealPage() {
  await requireUser();
  const pipedriveOn = isPipedriveConfigured();

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/deals" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Back to deals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">New deal</h1>
        <p className="mt-1 text-sm text-slate-600">
          You&apos;ll be the owner. Add other members after the deal is created.
        </p>
      </div>

      {pipedriveOn ? (
        <PipedrivePicker />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
          <div className="font-medium text-slate-800">Pipedrive import not available.</div>
          <div className="mt-1">
            The server doesn&apos;t see <code className="rounded bg-slate-200 px-1">PIPEDRIVE_API_KEY</code>. Set
            it in <em>Vercel Project → Settings → Environment Variables</em> for the same environment
            you&apos;re viewing (Production or Preview), then redeploy — Vercel does not hot-apply
            env changes.
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">
          {pipedriveOn ? "Or create from scratch" : "Create a deal"}
        </h2>
        <form action={createDeal} className="mt-4 space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-800">
              Deal name
            </label>
            <input
              id="name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Project Atlas"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label htmlFor="dealCode" className="block text-sm font-medium text-slate-800">
              Deal code <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="dealCode"
              name="dealCode"
              maxLength={40}
              placeholder="ATLAS-2026"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <p className="mt-1 text-xs text-slate-500">
              Used as a shortcut in search and audit logs. Must be unique firm-wide.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link href="/deals" className="text-sm text-slate-600 hover:text-slate-800">
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Create deal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
