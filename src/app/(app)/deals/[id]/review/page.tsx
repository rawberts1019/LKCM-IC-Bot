import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess, canManageWorkspace } from "@/lib/access";
import { formatDateTime } from "@/lib/utils";

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
          thread: { include: { createdBy: { select: { email: true, name: true } } } }
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
          Questions the bot wasn't confident enough to auto-answer. Approve, edit, or reply on top.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          Queue is clear.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Asked by{" "}
                  {item.message.thread.createdBy.name ?? item.message.thread.createdBy.email} ·{" "}
                  {formatDateTime(item.createdAt)}
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {item.reason}
                </span>
              </div>
              <div className="text-sm text-slate-900">{item.message.content}</div>
              <div className="mt-3 text-xs text-slate-500">
                Approve / edit / reply flow lands in week 2.
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
