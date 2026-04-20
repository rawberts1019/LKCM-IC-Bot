"use client";

export function PrintTriggers() {
  return (
    <div className="no-print mb-4 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => window.close()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
      >
        Close
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
