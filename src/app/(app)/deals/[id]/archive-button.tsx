"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWorkspaceStatus } from "../actions";

export function ArchiveButton({
  workspaceId,
  archived
}: {
  workspaceId: string;
  archived: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClick() {
    const verb = archived ? "Unarchive" : "Archive";
    if (!archived) {
      if (
        !confirm(
          "Archive this deal? It becomes read-only — no new questions, uploads, or risks. You can unarchive later."
        )
      ) {
        return;
      }
    }
    setError(null);
    startTransition(async () => {
      try {
        await setWorkspaceStatus({ workspaceId, archived: !archived });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : `${verb} failed.`);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
          archived
            ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {isPending
          ? archived
            ? "Unarchiving…"
            : "Archiving…"
          : archived
            ? "Unarchive deal"
            : "Archive deal"}
      </button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
