"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshPipedrive } from "../actions";

export function RefreshPipedriveButton({ workspaceId }: { workspaceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await refreshPipedrive(workspaceId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Refresh failed.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {isPending ? "Refreshing…" : "Refresh from Pipedrive"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
