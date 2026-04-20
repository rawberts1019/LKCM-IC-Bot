"use client";

import Link from "next/link";
import { useState } from "react";

export type DashboardMessage = {
  id: string;
  role: string;
  status: string;
  content: string;
  confidence: number | null;
  createdAt: string;
  createdBy: { name: string | null; email: string } | null;
};

export type DashboardThread = {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
  createdBy: { name: string | null; email: string };
  messages: DashboardMessage[];
};

export type DashboardDeal = {
  id: string;
  name: string;
  dealCode: string | null;
  orgName: string | null;
  stageName: string | null;
  updatedAt: string;
  pendingReviewCount: number;
  threadCount: number;
  threads: DashboardThread[];
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function roleLabel(role: string): string {
  return role === "user" ? "You" : role === "dealteam" ? "Deal team" : "IC Bot";
}

function roleColor(role: string): string {
  return role === "user"
    ? "bg-slate-100 text-slate-800"
    : role === "dealteam"
      ? "bg-indigo-100 text-indigo-800"
      : "bg-emerald-100 text-emerald-800";
}

function preview(content: string, n = 140): string {
  const stripped = content.replace(/\s+/g, " ").trim();
  return stripped.length > n ? stripped.slice(0, n - 1) + "\u2026" : stripped;
}

export function DashboardTree({ deals }: { deals: DashboardDeal[] }) {
  // Expand the first deal by default so the view doesn't start all-collapsed.
  const [openDeals, setOpenDeals] = useState<Set<string>>(
    () => new Set(deals.slice(0, 1).map((d) => d.id))
  );
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set());

  function toggleDeal(id: string) {
    setOpenDeals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleThread(id: string) {
    setOpenThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ul className="space-y-2">
      {deals.map((deal) => {
        const dealOpen = openDeals.has(deal.id);
        return (
          <li key={deal.id} className="rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => toggleDeal(deal.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`inline-block text-xs text-slate-400 transition-transform ${
                    dealOpen ? "rotate-90" : ""
                  }`}
                  aria-hidden
                >
                  &#9656;
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {deal.name}
                    </span>
                    {deal.dealCode ? (
                      <span className="text-xs text-slate-500">{deal.dealCode}</span>
                    ) : null}
                    {deal.stageName ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {deal.stageName}
                      </span>
                    ) : null}
                    {deal.pendingReviewCount > 0 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {deal.pendingReviewCount} pending
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {deal.orgName ? `${deal.orgName} · ` : ""}
                    {deal.threads.length} thread{deal.threads.length === 1 ? "" : "s"} visible ·
                    last activity {fmtDate(deal.updatedAt)}
                  </div>
                </div>
              </div>
              <Link
                href={`/deals/${deal.id}/chat`}
                className="shrink-0 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={(e) => e.stopPropagation()}
              >
                Open
              </Link>
            </button>

            {dealOpen ? (
              <ul className="space-y-1 border-t border-slate-100 px-4 pb-3 pt-2">
                {deal.threads.length === 0 ? (
                  <li className="px-2 py-3 text-xs text-slate-500">
                    No threads on this deal yet.
                  </li>
                ) : (
                  deal.threads.map((thread) => {
                    const threadOpen = openThreads.has(thread.id);
                    return (
                      <li
                        key={thread.id}
                        className="rounded-md border border-slate-100 bg-slate-50/40"
                      >
                        <button
                          type="button"
                          onClick={() => toggleThread(thread.id)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-100/60"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={`inline-block text-xs text-slate-400 transition-transform ${
                                threadOpen ? "rotate-90" : ""
                              }`}
                              aria-hidden
                            >
                              &#9656;
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm text-slate-900">
                                {thread.title ?? "Untitled thread"}
                              </div>
                              <div className="text-xs text-slate-500">
                                {thread.createdBy.name ?? thread.createdBy.email} ·
                                {" "}
                                {thread.messageCount} message
                                {thread.messageCount === 1 ? "" : "s"} · updated
                                {" "}
                                {fmtDate(thread.updatedAt)}
                              </div>
                            </div>
                          </div>
                          <Link
                            href={`/deals/${deal.id}/chat?thread=${thread.id}`}
                            className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open
                          </Link>
                        </button>

                        {threadOpen ? (
                          <ul className="space-y-2 border-t border-slate-100 px-3 py-3">
                            {thread.messages.length === 0 ? (
                              <li className="text-xs text-slate-500">
                                No messages yet.
                              </li>
                            ) : (
                              thread.messages.map((m) => (
                                <li
                                  key={m.id}
                                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span
                                      className={`rounded px-1.5 py-0.5 font-medium ${roleColor(m.role)}`}
                                    >
                                      {roleLabel(m.role)}
                                    </span>
                                    {m.createdBy && m.role !== "assistant" ? (
                                      <span className="text-slate-600">
                                        {m.createdBy.name ?? m.createdBy.email}
                                      </span>
                                    ) : null}
                                    {m.status === "queued" ? (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                        under review
                                      </span>
                                    ) : null}
                                    {m.role === "assistant" && m.confidence !== null ? (
                                      <span className="text-slate-400">
                                        conf {(m.confidence * 100).toFixed(0)}%
                                      </span>
                                    ) : null}
                                    <span className="ml-auto text-slate-400">
                                      {fmtDate(m.createdAt)}
                                    </span>
                                  </div>
                                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                                    {preview(m.content)}
                                  </div>
                                </li>
                              ))
                            )}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
