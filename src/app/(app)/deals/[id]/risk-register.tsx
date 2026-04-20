"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addRisk, deleteRisk, extractRisks, updateRisk } from "./risks/actions";

export type RiskRow = {
  id: string;
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
  status: "open" | "mitigated" | "accepted";
  createdAt: string;
  sourceMessageId: string | null;
  createdBy: { name: string | null; email: string };
};

function severityBadge(severity: RiskRow["severity"]): string {
  if (severity === "high") return "bg-red-100 text-red-800";
  if (severity === "medium") return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

function statusBadge(status: RiskRow["status"]): string {
  if (status === "mitigated") return "bg-emerald-100 text-emerald-800";
  if (status === "accepted") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

export function RiskRegister({
  workspaceId,
  risks,
  canManage
}: {
  workspaceId: string;
  risks: RiskRow[];
  canManage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"high" | "medium" | "low">("medium");
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const open = risks.filter((r) => r.status === "open");
  const resolved = risks.filter((r) => r.status !== "open");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await addRisk({ workspaceId, title, description, severity });
        setTitle("");
        setDescription("");
        setSeverity("medium");
        setShowAdd(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add risk.");
      }
    });
  }

  function handleExtract() {
    setExtractStatus("Reading documents…");
    setError(null);
    startTransition(async () => {
      try {
        const result = await extractRisks({ workspaceId });
        setExtractStatus(
          result.added === 0
            ? "No new material risks identified."
            : `Added ${result.added} risk${result.added === 1 ? "" : "s"} from the documents.`
        );
        setTimeout(() => setExtractStatus(null), 4000);
        router.refresh();
      } catch (e) {
        setExtractStatus(null);
        setError(e instanceof Error ? e.message : "Extraction failed.");
      }
    });
  }

  function handleSetStatus(riskId: string, status: RiskRow["status"]) {
    startTransition(async () => {
      try {
        await updateRisk({ workspaceId, riskId, status });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed.");
      }
    });
  }

  function handleDelete(riskId: string) {
    if (!confirm("Delete this risk? This cannot be undone.")) return;
    startTransition(async () => {
      try {
        await deleteRisk({ workspaceId, riskId });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Risk register
          </h2>
          <p className="text-xs text-slate-500">
            {open.length} open · {resolved.length} resolved
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExtract}
              disabled={isPending}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {extractStatus ?? "Extract from documents"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd((v) => !v)}
              disabled={isPending}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {showAdd ? "Cancel" : "Add risk"}
            </button>
          </div>
        ) : null}
      </div>

      {showAdd && canManage ? (
        <form
          onSubmit={handleAdd}
          className="space-y-3 border-b border-slate-200 bg-slate-50 p-4 text-sm"
        >
          <div>
            <label className="block text-xs font-medium text-slate-700">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              minLength={3}
              maxLength={200}
              placeholder="Top customer = 34% of revenue"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as typeof severity)}
                className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {isPending ? "Adding…" : "Add to register"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      {risks.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">
          No risks on the register yet.
          {canManage ? (
            <>
              {" "}
              Click <em>Extract from documents</em> to seed from the uploaded docs, or{" "}
              <em>Add risk</em> manually.
            </>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {[...open, ...resolved].map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityBadge(r.severity)}`}
                    >
                      {r.severity}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(r.status)}`}
                    >
                      {r.status}
                    </span>
                    {r.sourceMessageId ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        from chat
                      </span>
                    ) : null}
                    <span className="text-sm font-medium text-slate-900">{r.title}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                    {r.description}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    added by {r.createdBy.name ?? r.createdBy.email}
                  </div>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {r.status === "open" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSetStatus(r.id, "mitigated")}
                          disabled={isPending}
                          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Mark mitigated
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetStatus(r.id, "accepted")}
                          disabled={isPending}
                          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Accept
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSetStatus(r.id, "open")}
                        disabled={isPending}
                        className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(r.id)}
                      disabled={isPending}
                      className="rounded-md border border-red-200 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
