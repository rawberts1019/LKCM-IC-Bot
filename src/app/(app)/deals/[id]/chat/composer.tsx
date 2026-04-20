"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { askQuestion } from "./actions";

export function Composer({
  workspaceId,
  threadId,
  documentsReady
}: {
  workspaceId: string;
  threadId?: string;
  documentsReady: number;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setError("Ask a fuller question.");
      return;
    }
    if (documentsReady === 0) {
      setError("Upload at least one document to this deal before asking.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("question", trimmed);
    if (threadId) fd.append("threadId", threadId);

    startTransition(async () => {
      try {
        await askQuestion(workspaceId, fd);
        setValue("");
        taRef.current?.focus();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        ref={taRef}
        name="question"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        disabled={isPending}
        placeholder={
          documentsReady === 0
            ? "Upload a document first, then ask about it here."
            : "Ask about this deal. Claude reads every uploaded document to answer."
        }
        className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {isPending ? (
            <span>Claude is reading the documents… this usually takes 10–30 seconds.</span>
          ) : (
            <span>
              {documentsReady} document{documentsReady === 1 ? "" : "s"} available · Cmd/Ctrl +
              Enter to send
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={isPending || value.trim().length < 2}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {isPending ? "Thinking…" : "Send"}
        </button>
      </div>
      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}
    </form>
  );
}
