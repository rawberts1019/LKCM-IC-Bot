"use client";

import { useTransition } from "react";
import { deleteDocument } from "./actions";

export function DeleteButton({
  workspaceId,
  documentId,
  filename
}: {
  workspaceId: string;
  documentId: string;
  filename: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!confirm(`Remove ${filename} from this deal?`)) return;
    startTransition(async () => {
      try {
        await deleteDocument(workspaceId, documentId);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
    >
      {isPending ? "Removing…" : "Remove"}
    </button>
  );
}
