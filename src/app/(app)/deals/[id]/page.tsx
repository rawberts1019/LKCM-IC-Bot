import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { formatDateTime } from "@/lib/utils";
import { Markdown } from "@/components/markdown";
import { MemberAddForm } from "./member-add-form";
import { PipedriveContext, type PipedriveMeta } from "./pipedrive-context";
import { RiskRegister, type RiskRow } from "./risk-register";
import { ArchiveButton } from "./archive-button";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireWorkspaceAccess(id);

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: {
      members: { include: { user: true }, orderBy: { createdAt: "asc" } },
      documents: { orderBy: { createdAt: "desc" }, take: 5 },
      threads: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: { createdBy: { select: { email: true, name: true } } }
      },
      reviewQueue: { where: { status: "pending" } },
      _count: { select: { documents: true, threads: true, reviewQueue: true } }
    }
  });

  if (!workspace) notFound();

  const canManage = user.role === "admin" || membership?.role === "owner" || membership?.role === "dealteam";
  const pendingReviews = workspace.reviewQueue.length;
  const isArchived = workspace.status === "archived";

  const [pinnedAnswers, risks] = await Promise.all([
    prisma.message.findMany({
      where: {
        thread: { workspaceId: id },
        pinnedAt: { not: null },
        role: { not: "user" },
        status: { not: "superseded" }
      },
      orderBy: { pinnedAt: "desc" },
      take: 10,
      include: {
        thread: { select: { id: true, title: true } }
      }
    }),
    prisma.risk.findMany({
      where: { workspaceId: id },
      orderBy: [
        { status: "asc" },
        { severity: "asc" },
        { createdAt: "desc" }
      ],
      include: { createdBy: { select: { name: true, email: true } } }
    })
  ]);

  const riskRows: RiskRow[] = risks.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    sourceMessageId: r.sourceMessageId,
    createdBy: { name: r.createdBy.name, email: r.createdBy.email }
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link href="/deals" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; All deals
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{workspace.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              {workspace.dealCode ? <span>{workspace.dealCode}</span> : null}
              {workspace.orgName ? <span>{workspace.orgName}</span> : null}
              {workspace.stageName ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  {workspace.stageName}
                </span>
              ) : null}
              {isArchived ? (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                  archived · read-only
                </span>
              ) : null}
              {workspace.pipedriveUrl ? (
                <a
                  href={workspace.pipedriveUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs text-slate-700 underline underline-offset-2 hover:text-slate-900"
                >
                  View in Pipedrive &rarr;
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex gap-2">
              <Link
                href={`/deals/${id}/chat`}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Ask a question
              </Link>
              {canManage && !isArchived ? (
                <Link
                  href={`/deals/${id}/upload`}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                >
                  Upload files
                </Link>
              ) : null}
            </div>
            {canManage ? (
              <ArchiveButton workspaceId={id} archived={isArchived} />
            ) : null}
          </div>
        </div>
      </div>

      {isArchived ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          This deal is archived and read-only. Past questions, documents, and risks stay visible;
          new uploads, questions, and risk edits are blocked until it&apos;s unarchived.
        </div>
      ) : null}

      {workspace.pipedriveMeta ? (
        <PipedriveContext
          workspaceId={id}
          meta={workspace.pipedriveMeta as unknown as PipedriveMeta}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat label="Documents" value={workspace._count.documents} />
        <Stat label="Threads" value={workspace._count.threads} />
        <Stat label="Members" value={workspace.members.length} />
        <Stat
          label="Pending review"
          value={pendingReviews}
          href={canManage && pendingReviews > 0 ? `/deals/${id}/review` : undefined}
          accent={pendingReviews > 0}
        />
      </div>

      <RiskRegister workspaceId={id} risks={riskRows} canManage={canManage} />

      {pinnedAnswers.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Pinned answers
          </h2>
          <ul className="space-y-3">
            {pinnedAnswers.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-amber-200 bg-amber-50/40 p-4"
              >
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">
                    {m.role === "dealteam" ? "Deal team" : "IC Bot"}
                    {" · "}
                    <Link
                      href={`/deals/${id}/chat?thread=${m.thread.id}`}
                      className="underline underline-offset-2 hover:text-slate-900"
                    >
                      {m.thread.title ?? "Untitled thread"}
                    </Link>
                  </span>
                  <span className="text-slate-500">{formatDateTime(m.pinnedAt!)}</span>
                </div>
                <div className="mt-2">
                  <Markdown>{m.content}</Markdown>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent documents
        </h2>
        {workspace.documents.length === 0 ? (
          <EmptyCard message="No documents uploaded yet." />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {workspace.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{d.filename}</div>
                  <div className="text-xs text-slate-500">
                    {d.status} · {formatDateTime(d.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent threads
        </h2>
        {workspace.threads.length === 0 ? (
          <EmptyCard message="No threads yet. Ask a question to start one." />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {workspace.threads.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/deals/${id}/chat?thread=${t.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50"
                >
                  <div>
                    <div className="font-medium text-slate-900">{t.title ?? "Untitled thread"}</div>
                    <div className="text-xs text-slate-500">
                      {t.createdBy.name ?? t.createdBy.email} · {formatDateTime(t.updatedAt)}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Members
        </h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {workspace.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-slate-900">{m.user.name ?? m.user.email}</div>
                <div className="text-xs text-slate-500">{m.user.email}</div>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {m.role}
              </span>
            </li>
          ))}
        </ul>

        {canManage ? <MemberAddForm workspaceId={id} /> : null}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  accent
}: {
  label: string;
  value: number;
  href?: string;
  accent?: boolean;
}) {
  const body = (
    <div
      className={`rounded-lg border bg-white p-4 ${
        accent ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
      {message}
    </div>
  );
}
