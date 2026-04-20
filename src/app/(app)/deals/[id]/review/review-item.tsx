"use client";

import { useState, useTransition } from "react";
import { approveAnswer, replyOnTop } from "./actions";

export function ReviewItem({
  workspaceId,
  messageId,
  draftAnswer,
  question,
  confidence,
  sources
}: {
  workspaceId: string;
  messageId: string;
  draftAnswer: string;
  question: string;
  confidence: number;
  sources: Array<{ filename: string; page?: number }>;
}) {
  const [mode, setMode] = useState<"closed" | "edit" | "reply">("closed");
  const [draft, setDraft] = useState(draftAnswer);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submitApprove(edited: boolean) {
    setError(null);
    const fd = new FormData();
    fd.append("messageId", messageId);
    if (edited) fd.append("editedContent", draft);
    startTransition(async () => {
      try {
        await approveAnswer(workspaceId, fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to approve.");
      }
    });
  }

  function submitReply() {
    if (reply.trim().length < 2) {
      setError("Write a longer reply.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.append("messageId", messageId);
    fd.append("content", reply.trim());
    startTransition(async () => {
      try {
        await replyOnTop(workspaceId, fd);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reply.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Question</div>
        <div className="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900">
          {question}
        </div>
      </div>

      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Draft answer · confidence {(confidence * 100).toFixed(0)}%
        </div>
        {mode === "edit" ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            disabled={isPending}
            className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        ) : (
          <div className="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-900">
            {draftAnswer}
          </div>
        )}
        {sources.length > 0 ? (
          <div className="mt-1 text-xs text-slate-500">
            Sources:{" "}
            {sources.map((s, i) => (
              <span key={i}>
                {s.filename}
                {s.page ? ` p.${s.page}` : ""}
                {i < sources.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {mode === "reply" ? (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Your reply (replaces the draft)
          </div>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={6}
            disabled={isPending}
            placeholder="Write the answer you want the asker to see…"
            className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "closed" ? (
          <>
            <button
              type="button"
              onClick={() => submitApprove(false)}
              disabled={isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {isPending ? "Sending…" : "Approve as-is"}
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Edit & approve
            </button>
            <button
              type="button"
              onClick={() => setMode("reply")}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Reply on top
            </button>
          </>
        ) : mode === "edit" ? (
          <>
            <button
              type="button"
              onClick={() => submitApprove(true)}
              disabled={isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {isPending ? "Sending…" : "Save & send to asker"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("closed");
                setDraft(draftAnswer);
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={submitReply}
              disabled={isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
            >
              {isPending ? "Sending…" : "Send reply to asker"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("closed");
                setReply("");
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
