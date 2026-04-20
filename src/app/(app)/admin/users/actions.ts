"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "member"])
});

export async function setUserRole(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = schema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role")
  });
  if (!parsed.success) return { ok: false as const, error: "Invalid input" };

  if (parsed.data.userId === admin.id && parsed.data.role === "member") {
    return { ok: false as const, error: "You can't demote yourself." };
  }

  await prisma.user.update({
    where: { id: parsed.data.userId },
    data: { role: parsed.data.role }
  });

  await logAudit({
    actorId: admin.id,
    action: "user.role.change",
    targetType: "user",
    targetId: parsed.data.userId,
    metadata: { role: parsed.data.role }
  });

  revalidatePath("/admin/users");
  return { ok: true as const };
}
