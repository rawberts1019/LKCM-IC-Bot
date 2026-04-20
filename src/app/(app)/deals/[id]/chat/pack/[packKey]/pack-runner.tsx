"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import type { QuestionPack } from "@/lib/question-packs";

type StreamEvent =
  | { type: "meta"; threadId: string }
  | { type: "text"; content: string }
  | {
      type: "done";
      messageId: string;
      status: "sent" | "queued";
      confidence: number;
    }
  | { type: "error"; code: string; message: string };

type AnswerState = {
  question: string;
  answer: string;
  status: "pending" | "streaming" | "done" | "queued" | "error";
  confidence: number | null;
  error?: string;
};

export function PackRunner({
  workspaceId,
  pack,
  threadTitle
}: {
  workspaceId: string;
  pack: QuestionPack;
  threadTitle: string;
}) {
  const [answers, setAnswers] = useState<AnswerState[]>(() =>
    pack.questions.map((q) => ({
      question: q,
      answer: "",
      status: "pending",
      confidence: null
    }))
  );
  const [running, setRunning] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const hasStarted = useRef(false);

  useEffect(() => {
    // Only kick off once, even under React 18 strict-mode double-mount.
    if (hasStarted.current) return;
    hasStarted.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run() {
    setRunning(true);
    let currentThreadId: string | undefined = undefined;

    for (let i = 0; i < pack.questions.length; i++) {
      const q = pack.questions[i];
      setAnswers((prev) => {
        const next = [...prev];
        next[i] = { ...next[i], status: "streaming" };
        return next;
      });

      try {
        const res = await fetch("/api/chat/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, threadId: currentThreadId, question: q })
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          let msg = "Question failed.";
          try {
            const json = JSON.parse(text);
            if (typeof json?.error === "string") msg = json.error;
          } catch {
            if (text) msg = text.slice(0, 200);
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
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
              if (!currentThreadId) {
                currentThreadId = ev.threadId;
                setThreadId(ev.threadId);
              }
            } else if (ev.type === "text") {
              setAnswers((prev) => {
                const next = [...prev];
                next[i] = { ...next[i], answer: next[i].answer + ev.content };
                return next;
              });
            } else if (ev.type === "done") {
              setAnswers((prev) => {
                const next = [...prev];
                next[i] = {
                  ...next[i],
                  status: ev.status === "queued" ? "queued" : "done",
                  confidence: ev.confidence
                };
                return next;
              });
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Question failed.";
        setAnswers((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], status: "error", error: message };
          return next;
        });
        // A rate-limit or auth error will recur on the remaining questions,
        // so bail out early instead of burning through the pack.
        if (/rate-limited|API key/i.test(message)) {
          setFatalError(message);
          break;
        }
      }
    }

    setRunning(false);
  }

  const completedCount = answers.filter(
    (a) => a.status === "done" || a.status === "queued" || a.status === "error"
  ).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-slate-900">{threadTitle}</div>
            <div className="text-xs text-slate-500">
              {completedCount} of {pack.questions.length} answered
              {running ? " · streaming…" : ""}
            </div>
          </div>
          {threadId ? (
            <Link
              href={`/deals/${workspaceId}/chat?thread=${threadId}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Open thread
            </Link>
          ) : null}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-slate-800 transition-all duration-300"
            style={{ width: `${(completedCount / pack.questions.length) * 100}%` }}
          />
        </div>
      </div>

      {fatalError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          Aborted: {fatalError}
        </div>
      ) : null}

      <ol className="space-y-4">
        {answers.map((a, i) => (
          <li
            key={i}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                Q{i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">{a.question}</div>
                <div className="mt-2">
                  {a.status === "pending" ? (
                    <div className="text-xs text-slate-400">waiting…</div>
                  ) : a.status === "streaming" && !a.answer ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                      reading documents…
                    </div>
                  ) : a.status === "error" ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                      {a.error}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs">
                        {a.status === "streaming" ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                            streaming
                          </span>
                        ) : a.status === "queued" ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                            under review
                          </span>
                        ) : (
                          <span className="text-emerald-600">done</span>
                        )}
                        {a.confidence !== null ? (
                          <span className="text-slate-400">
                            conf {(a.confidence * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1">
                        <Markdown>{a.answer}</Markdown>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
