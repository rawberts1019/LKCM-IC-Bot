import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { prisma } from "@/lib/db";
import { estimateCostUsd, formatTokens, formatUsd } from "@/lib/pricing";
import { env } from "@/env";

export default async function AdminUsagePage() {
  await requireAdmin();

  // Everything we need in three aggregation queries. 30-day window for
  // "recent" activity; all-time for the totals.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [perDeal, perUser, feedbackByDeal, totals, last30dCount] = await Promise.all([
    // Per-deal token + cost breakdown.
    prisma.message.groupBy({
      by: ["threadId"],
      where: { role: "assistant" },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true
      },
      _count: { _all: true }
    }),
    // Per-user question volume.
    prisma.message.groupBy({
      by: ["createdById"],
      where: { role: "user", createdById: { not: null } },
      _count: { _all: true }
    }),
    // 👍 / 👎 counts per deal (via thread → workspace).
    prisma.messageFeedback.findMany({
      select: { vote: true, message: { select: { thread: { select: { workspaceId: true } } } } }
    }),
    // Workspace-agnostic totals.
    prisma.message.aggregate({
      where: { role: "assistant" },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheCreationTokens: true,
        cacheReadTokens: true
      },
      _count: { _all: true }
    }),
    prisma.message.count({
      where: { role: "user", createdAt: { gte: since } }
    })
  ]);

  // Join threadId → workspaceId + name.
  const threads = await prisma.thread.findMany({
    where: { id: { in: perDeal.map((r) => r.threadId) } },
    select: { id: true, workspaceId: true, workspace: { select: { name: true, dealCode: true } } }
  });
  const threadToWorkspace = new Map(threads.map((t) => [t.id, t]));

  type DealRow = {
    workspaceId: string;
    name: string;
    dealCode: string | null;
    questions: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costUsd: number;
    thumbsUp: number;
    thumbsDown: number;
  };
  const dealMap = new Map<string, DealRow>();
  for (const g of perDeal) {
    const t = threadToWorkspace.get(g.threadId);
    if (!t) continue;
    const row = dealMap.get(t.workspaceId) ?? {
      workspaceId: t.workspaceId,
      name: t.workspace.name,
      dealCode: t.workspace.dealCode,
      questions: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      thumbsUp: 0,
      thumbsDown: 0
    };
    row.questions += g._count._all;
    row.inputTokens += g._sum.inputTokens ?? 0;
    row.outputTokens += g._sum.outputTokens ?? 0;
    row.cacheCreationTokens += g._sum.cacheCreationTokens ?? 0;
    row.cacheReadTokens += g._sum.cacheReadTokens ?? 0;
    row.costUsd = estimateCostUsd({ ...row, model: env.ANTHROPIC_MODEL });
    dealMap.set(t.workspaceId, row);
  }
  for (const f of feedbackByDeal) {
    const wsId = f.message.thread.workspaceId;
    const row = dealMap.get(wsId);
    if (!row) continue;
    if (f.vote === "up") row.thumbsUp += 1;
    else if (f.vote === "down") row.thumbsDown += 1;
  }
  const dealRows = [...dealMap.values()].sort((a, b) => b.costUsd - a.costUsd);

  // Top users by question volume. Pull emails in one extra query.
  const userIds = perUser
    .map((p) => p.createdById)
    .filter((id): id is string => Boolean(id));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const userRows = perUser
    .map((p) => ({
      userId: p.createdById!,
      name: userMap.get(p.createdById!)?.name ?? null,
      email: userMap.get(p.createdById!)?.email ?? "—",
      questions: p._count._all
    }))
    .sort((a, b) => b.questions - a.questions)
    .slice(0, 25);

  const totalCost = dealRows.reduce((n, r) => n + r.costUsd, 0);
  const totalInTokens = totals._sum.inputTokens ?? 0;
  const totalOutTokens = totals._sum.outputTokens ?? 0;
  const totalCacheCreate = totals._sum.cacheCreationTokens ?? 0;
  const totalCacheRead = totals._sum.cacheReadTokens ?? 0;
  const cacheHitRate =
    totalCacheCreate + totalCacheRead > 0
      ? totalCacheRead / (totalCacheCreate + totalCacheRead)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Cost &amp; usage</h1>
        <p className="mt-1 text-sm text-slate-600">
          Estimated Anthropic spend and question volume across the firm. Cost figures are
          ballparks based on list pricing — not for invoicing.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Est. total cost" value={formatUsd(totalCost)} />
        <Stat label="Assistant calls" value={totals._count._all.toLocaleString()} />
        <Stat label="Questions (30d)" value={last30dCount.toLocaleString()} />
        <Stat
          label="Cache hit rate"
          value={`${(cacheHitRate * 100).toFixed(0)}%`}
          hint="% of input tokens served from prompt cache vs. freshly created"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Input tokens" value={formatTokens(totalInTokens)} subtle />
        <Stat label="Output tokens" value={formatTokens(totalOutTokens)} subtle />
        <Stat label="Cache writes" value={formatTokens(totalCacheCreate)} subtle />
        <Stat label="Cache reads" value={formatTokens(totalCacheRead)} subtle />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          By deal
        </h2>
        {dealRows.length === 0 ? (
          <EmptyCard message="No assistant activity yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Deal</th>
                  <th className="px-3 py-2 text-right font-medium">Questions</th>
                  <th className="px-3 py-2 text-right font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Output</th>
                  <th className="px-3 py-2 text-right font-medium">Cache read</th>
                  <th className="px-3 py-2 text-right font-medium">👍 / 👎</th>
                  <th className="px-3 py-2 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dealRows.map((r) => (
                  <tr key={r.workspaceId}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/deals/${r.workspaceId}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.dealCode ? (
                        <div className="text-xs text-slate-500">{r.dealCode}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.questions}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatTokens(r.inputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatTokens(r.outputTokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatTokens(r.cacheReadTokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-emerald-700">{r.thumbsUp}</span>
                      <span className="text-slate-300"> / </span>
                      <span className="text-red-700">{r.thumbsDown}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatUsd(r.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Top users by question volume
        </h2>
        {userRows.length === 0 ? (
          <EmptyCard message="No questions asked yet." />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {userRows.map((r) => (
              <li key={r.userId} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{r.name ?? r.email}</div>
                  {r.name ? <div className="text-xs text-slate-500">{r.email}</div> : null}
                </div>
                <div className="tabular-nums text-slate-700">
                  {r.questions} question{r.questions === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  subtle
}: {
  label: string;
  value: string;
  hint?: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        subtle ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
      {message}
    </div>
  );
}
