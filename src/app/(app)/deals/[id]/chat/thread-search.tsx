"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Hit = {
  id: string;
  title: string | null;
  updatedAt: string;
  snippet: string | null;
  snippetRole: string | null;
};

export function ThreadSearch({ workspaceId }: { workspaceId: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/deals/${workspaceId}/search?q=${encodeURIComponent(q.trim())}`,
          { signal: ctrl.signal }
        );
        if (res.ok) {
          const data = (await res.json()) as { threads: Hit[] };
          setHits(data.threads ?? []);
        }
      } catch {
        // aborted; ignore
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, workspaceId]);

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search threads…"
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
      />
      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-500">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">No matches in this deal.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`/deals/${workspaceId}/chat?thread=${h.id}`}
                    onMouseDown={(e) => e.preventDefault()}
                    className="block px-3 py-2 hover:bg-slate-50"
                  >
                    <div className="truncate text-sm font-medium text-slate-900">
                      {h.title ?? "Untitled thread"}
                    </div>
                    {h.snippet ? (
                      <div className="mt-0.5 truncate text-xs text-slate-600">
                        {h.snippetRole === "user" ? "Q: " : h.snippetRole === "dealteam" ? "Deal team: " : "A: "}
                        {h.snippet}
                      </div>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
