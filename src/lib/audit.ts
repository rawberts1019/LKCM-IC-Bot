import { prisma } from "@/lib/db";

type AuditInput = {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Append-only audit log. Never update or delete rows here — if an action is
 * corrected, write a second row describing the correction.
 *
 * Admins can view these via /admin/audit. In phase 1b we also mirror rows to
 * S3 nightly for WORM-like durability.
 */
export async function logAudit(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      metadata: input.metadata as object | undefined
    }
  });
}
