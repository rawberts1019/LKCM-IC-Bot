"use client";

import { useState } from "react";
import Link from "next/link";

export function MessageActions({
  workspaceId,
  messageId,
  exportText
}: {
  workspaceId: string;
  messageId: string;
  exportText: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(exportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers
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

  return (
    <div className="flex items-center gap-2 text-xs">
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
