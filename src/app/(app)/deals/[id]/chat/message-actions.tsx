"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { togglePin, voteOnMessage } from "./actions";

export function MessageActions({
  workspaceId,
  messageId,
  exportText,
  initialPinned,
  initialUserVote,
  initialUpCount,
  initialDownCount
}: {
  workspaceId: string;
  messageId: string;
  exportText: string;
  initialPinned: boolean;
  initialUserVote: "up" | "down" | null;
  initialUpCount: number;
  initialDownCount: number;
}) {
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(initialPinned);
  const [userVote, setUserVote] = useState<"up" | "down" | null>(initialUserVote);
  const [upCount, setUpCount] = useState(initialUpCount);
  const [downCount, setDownCount] = useState(initialDownCount);
  const [isPending, startTransition] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const t = document.createElement("textarea");
      t.value = exportText;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      document.body.removeChild(t);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function handlePin() {
    startTransition(async () => {
      try {
        const { pinnedAt } = await togglePin({ workspaceId, messageId });
        setPinned(Boolean(pinnedAt));
      } catch {
        // silent — button state unchanged
      }
    });
  }

  function handleVote(vote: "up" | "down") {
    startTransition(async () => {
      try {
        const result = await voteOnMessage({ workspaceId, messageId, vote });
        setUserVote(result.userVote);
        setUpCount(result.upCount);
        setDownCount(result.downCount);
      } catch {
        // silent
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        onClick={handlePin}
        disabled={isPending}
        aria-pressed={pinned}
        className={`rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
          pinned
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        title={pinned ? "Unpin from deal summary" : "Pin to deal summary"}
      >
        {pinned ? "★ Pinned" : "Pin"}
      </button>
      <button
        type="button"
        onClick={() => handleVote("up")}
        disabled={isPending}
        className={`rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
          userVote === "up"
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        aria-pressed={userVote === "up"}
        title="This answer was helpful"
      >
        👍 {upCount > 0 ? upCount : ""}
      </button>
      <button
        type="button"
        onClick={() => handleVote("down")}
        disabled={isPending}
        className={`rounded-md border px-2 py-1 transition-colors disabled:opacity-50 ${
          userVote === "down"
            ? "border-red-300 bg-red-50 text-red-800"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
        aria-pressed={userVote === "down"}
        title="This answer was wrong or unhelpful"
      >
        👎 {downCount > 0 ? downCount : ""}
      </button>
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
      >
        {copied ? "Copied ✓" : "Copy for memo"}
      </button>
      <Link
        href={`/deals/${workspaceId}/export/${messageId}`}
        target="_blank"
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
      >
        Print / PDF
      </Link>
    </div>
  );
}
