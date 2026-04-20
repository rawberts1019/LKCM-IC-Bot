import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: "admin" | "member";
};

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    redirect("/login");
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect("/deals");
  }
  return user;
}

/**
 * Throws (via redirect) if the user is not a member of the workspace AND not an admin.
 * Returns the membership row (or null for admin-override access).
 */
export async function requireWorkspaceAccess(workspaceId: string) {
  const user = await requireUser();

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } }
  });

  if (!membership && user.role !== "admin") {
    redirect("/deals");
  }

  return { user, membership };
}

export function canManageWorkspace(membershipRole: string | undefined, userRole: "admin" | "member") {
  if (userRole === "admin") return true;
  return membershipRole === "owner" || membershipRole === "dealteam";
}

/**
 * Guards write paths on archived deals. Reads + pin/vote/read-only curation
 * are still allowed; any action that creates new content (questions, docs,
 * members, risks, refreshes) should call this first.
 */
export async function assertActive(workspaceId: string): Promise<void> {
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { status: true }
  });
  if (!row) throw new Error("Deal not found.");
  if (row.status === "archived") {
    throw new Error(
      "This deal is archived and read-only. Unarchive it to make changes."
    );
  }
}
