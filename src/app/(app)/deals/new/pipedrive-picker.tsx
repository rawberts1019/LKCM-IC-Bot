"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { importFromPipedrive } from "../actions";

type Deal = {
  id: number;
  title: string;
  orgName: string | null;
  stageName: string | null;
  ownerName: string | null;
  value: number | null;
  currency: string | null;
};

function formatValue(value: number | null, currency: string | null): string {
  if (typeof value !== "number") return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency ?? ""}`.trim();
  }
}

export function PipedrivePicker() {
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  async function fetchDeals(q: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/pipedrive/deals", window.location.origin);
      if (q.trim().length >= 2) url.searchParams.set("q", q.trim());
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { deals: Deal[] };
      setDeals(data.deals);
      setLoaded(true);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        setError(e.message);
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }

  // Debounced query search; initial open-deals list on mount.
  useEffect(() => {
    if (!loaded) {
      fetchDeals("");
      return;
    }
    const t = setTimeout(() => fetchDeals(query), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function handleImport(dealId: number) {
    const fd = new FormData();
    fd.append("pipedriveDealId", String(dealId));
    startTransition(async () => {
      try {
        await importFromPipedrive(fd);
        // Redirect happens in the server action; nothing to do here.
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Import from Pipedrive</h2>
          <p className="text-xs text-slate-500">
            Pulls the deal name, organization, stage, value, and owner. You&apos;ll be set as
            workspace owner automatically.
          </p>
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Pipedrive deals by name…"
        className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
      />

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-slate-200">
        {loading ? (
          <div className="p-4 text-xs text-slate-500">Loading Pipedrive deals…</div>
        ) : deals.length === 0 ? (
          <div className="p-4 text-xs text-slate-500">
            {query.trim() ? "No matches in Pipedrive." : "No open deals found."}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {deals.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{d.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {[
                      d.orgName,
                      d.stageName,
                      formatValue(d.value, d.currency),
                      d.ownerName
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleImport(d.id)}
                  disabled={isPending}
                  className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isPending ? "Importing…" : "Import"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
