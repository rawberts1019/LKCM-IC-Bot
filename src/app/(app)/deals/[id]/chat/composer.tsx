"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/components/markdown";

type StreamEvent =
  | { type: "meta"; threadId: string }
  | { type: "text"; content: string }
  | {
      type: "done";
      messageId: string;
      status: "sent" | "queued";
      confidence: number;
      sources: Array<{ filename: string; page?: number; snippet?: string }>;
    }
  | { type: "error"; code: string; message: string };

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
  const [isStreaming, setIsStreaming] = useState(false);
  // Live preview of what the user just asked + what's streaming back.
  // Cleared on done (router.refresh pulls the persisted version).
  const [live, setLive] = useState<{ question: string; answer: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // If the URL has #compose (e.g. a Teams card click), scroll to and focus the
  // textarea on mount so partners land ready to type.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#compose") {
      taRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      taRef.current?.focus();
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
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
    setIsStreaming(true);
    setLive({ question: trimmed, answer: "" });

    let newThreadId: string | null = null;
    try {
      const res = await fetch("/api/chat/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          threadId,
          question: trimmed
        })
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        let message = "Something went wrong.";
        try {
          const json = JSON.parse(text);
          if (typeof json?.error === "string") message = json.error;
        } catch {
          if (text) message = text.slice(0, 300);
        }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;

          let ev: StreamEvent;
          try {
            ev = JSON.parse(json) as StreamEvent;
          } catch {
            continue;
          }

          if (ev.type === "meta") {
            if (!threadId) {
              // Remember the new thread id so that when the stream finishes we
              // can navigate to the persisted URL. We intentionally don't
              // navigate mid-stream — that would re-render the page and kill
              // the live preview.
              newThreadId = ev.threadId;
            }
          } else if (ev.type === "text") {
            setLive((prev) =>
              prev ? { ...prev, answer: prev.answer + ev.content } : prev
            );
          } else if (ev.type === "done") {
            // fall through — loop will exit when stream ends
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        }
      }

      setValue("");
      setLive(null);
      if (newThreadId) {
        // New thread: navigate to its URL. This both updates the URL and
        // refetches server data so the persisted messages replace the
        // live preview.
        router.replace(`/deals/${workspaceId}/chat?thread=${newThreadId}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLive(null);
    } finally {
      setIsStreaming(false);
      setTimeout(() => taRef.current?.focus(), 0);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div>
      {live ? (
        <div className="mb-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              You
            </div>
            <div className="mt-1 whitespace-pre-wrap text-slate-900">{live.question}</div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <span>IC Bot</span>
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-amber-600">streaming</span>
            </div>
            <div className="mt-1 min-h-[1.25rem]">
              {live.answer ? (
                <Markdown>{live.answer}</Markdown>
              ) : (
                <span className="text-xs text-slate-500">
                  Claude is reading the documents…
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <textarea
          ref={taRef}
          name="question"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={isStreaming}
          placeholder={
            documentsReady === 0
              ? "Upload a document first, then ask about it here."
              : "Ask about this deal. Claude reads every uploaded document to answer."
          }
          className="w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-500"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {isStreaming ? (
              <span>Streaming answer… don&apos;t close this tab.</span>
            ) : (
              <span>
                {documentsReady} document{documentsReady === 1 ? "" : "s"} available · Cmd/Ctrl +
                Enter to send
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isStreaming || value.trim().length < 2}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {isStreaming ? "Streaming…" : "Send"}
          </button>
        </div>
        {error ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </div>
        ) : null}
      </form>
    </div>
  );
}
