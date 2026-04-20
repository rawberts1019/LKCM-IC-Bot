"use client";

import Link from "next/link";
import { useState } from "react";
import { PACKS } from "@/lib/question-packs";

export function PackPicker({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Run a question pack
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-10 mb-2 w-80 rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Question packs
            </div>
            <div className="text-xs text-slate-500">
              Batch-ask a standard set of IC diligence questions. Opens a new thread.
            </div>
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {PACKS.map((p) => (
              <li key={p.key}>
                <Link
                  href={`/deals/${workspaceId}/chat/pack/${p.key}`}
                  className="block px-3 py-2 text-sm hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="font-medium text-slate-900">{p.title}</div>
                  <div className="text-xs text-slate-500">
                    {p.questions.length} questions · {p.description}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
