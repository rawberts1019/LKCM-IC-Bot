import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { formatDateTime } from "@/lib/utils";
import { ReviewItem } from "./review-item";

type Citations = {
  sources?: Array<{ filename: string; page?: number; snippet?: string }>;
};

export default async function ReviewQueuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, membership } = await requireWorkspaceAccess(id);
  if (!canManageWorkspace(membership?.role, user.role)) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-600">
        Only deal-team members can review queued questions.
      </div>
    );
  }

  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) notFound();

  const items = await prisma.reviewQueueItem.findMany({
    where: { workspaceId: id, status: "pending" },
    orderBy: { createdAt: "asc" },
    include: {
      message: {
        include: {
          thread: {
            include: {
              createdBy: { select: { email: true, name: true } },
              messages: {
                where: { role: "user" },
                orderBy: { createdAt: "desc" },
                take: 1
              }
            }
          }
        }
      }
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/deals/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Back to {workspace.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Review queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Questions the bot wasn&apos;t confident enough to auto-answer, or flagged as sensitive.
          Approve, edit, or reply on top.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          Queue is clear.
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const citations = (item.message.citationsJson as Citations | null) ?? {};
            const sources = citations.sources ?? [];
            const askerName =
              item.message.thread.createdBy.name ?? item.message.thread.createdBy.email;
            const question =
              item.message.thread.messages[0]?.content ?? "(question text unavailable)";
            return (
              <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    Asked by {askerName} · {formatDateTime(item.createdAt)}
                  </span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {item.reason}
                  </span>
                </div>
                <ReviewItem
                  workspaceId={id}
                  messageId={item.message.id}
                  draftAnswer={item.message.content}
                  question={question}
                  confidence={item.message.confidence ?? 0}
                  sources={sources}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
