import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { DashboardTree, type DashboardDeal } from "./dashboard-tree";

export default async function DashboardPage() {
  const user = await requireUser();

  // Workspaces the user has access to. Admins see everything; everyone else
  // sees only the deals they're members of. Archived deals stay out of the
  // dashboard — partners care about live diligence.
  const workspaces = await prisma.workspace.findMany({
    where:
      user.role === "admin"
        ? { status: "active" }
        : { status: "active", members: { some: { userId: user.id } } },
    orderBy: { updatedAt: "desc" },
    include: {
      members: {
        where: { userId: user.id },
        select: { role: true }
      },
      threads: {
        orderBy: { updatedAt: "desc" },
        take: 15,
        include: {
          createdBy: { select: { name: true, email: true } },
          messages: {
            where: { status: { not: "superseded" } },
            orderBy: { createdAt: "asc" },
            take: 10,
            include: { createdBy: { select: { name: true, email: true } } }
          },
          _count: { select: { messages: true } }
        }
      },
      _count: { select: { threads: true, reviewQueue: { where: { status: "pending" } } } }
    }
  });

  // Scope-by-membership rule: IC members only see threads they started.
  // Deal team / owners / admin see all threads in the workspace.
  const deals: DashboardDeal[] = workspaces.map((w) => {
    const myRole = user.role === "admin" ? "admin" : w.members[0]?.role ?? null;
    const canSeeAllThreads =
      user.role === "admin" || myRole === "owner" || myRole === "dealteam";

    const visibleThreads = canSeeAllThreads
      ? w.threads
      : w.threads.filter((t) => t.createdById === user.id);

    return {
      id: w.id,
      name: w.name,
      dealCode: w.dealCode,
      orgName: w.orgName,
      stageName: w.stageName,
      updatedAt: w.updatedAt.toISOString(),
      pendingReviewCount: w._count.reviewQueue,
      threadCount: w._count.threads,
      threads: visibleThreads.map((t) => ({
        id: t.id,
        title: t.title,
        updatedAt: t.updatedAt.toISOString(),
        messageCount: t._count.messages,
        createdBy: {
          name: t.createdBy.name,
          email: t.createdBy.email
        },
        messages: t.messages.map((m) => ({
          id: m.id,
          role: m.role,
          status: m.status,
          content: m.content,
          confidence: m.confidence,
          createdAt: m.createdAt.toISOString(),
          createdBy: m.createdBy
            ? { name: m.createdBy.name, email: m.createdBy.email }
            : null
        }))
      }))
    };
  });

  const totalThreads = deals.reduce((n, d) => n + d.threads.length, 0);
  const totalPending = deals.reduce((n, d) => n + d.pendingReviewCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          {deals.length} deal{deals.length === 1 ? "" : "s"} · {totalThreads} visible thread
          {totalThreads === 1 ? "" : "s"}
          {totalPending > 0 ? ` · ${totalPending} pending review` : ""}
        </p>
      </div>

      {deals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
          You&apos;re not on any active deals yet.
        </div>
      ) : (
        <DashboardTree deals={deals} />
      )}
    </div>
  );
}
