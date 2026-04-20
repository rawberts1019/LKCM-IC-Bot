"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const createDealSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dealCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined))
});

export async function createDeal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = createDealSchema.safeParse({
    name: formData.get("name"),
    dealCode: formData.get("dealCode") ?? undefined
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: parsed.data.name,
      dealCode: parsed.data.dealCode,
      createdById: user.id,
      members: {
        create: { userId: user.id, role: "owner" }
      }
    }
  });

  await logAudit({
    actorId: user.id,
    action: "workspace.create",
    targetType: "workspace",
    targetId: workspace.id,
    workspaceId: workspace.id,
    metadata: { name: workspace.name, dealCode: workspace.dealCode }
  });

  revalidatePath("/deals");
  redirect(`/deals/${workspace.id}`);
}

const addMemberSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["owner", "dealteam", "ic"])
});

export async function addMember(formData: FormData): Promise<void> {
  const parsed = addMemberSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role")
  });
  if (!parsed.success) throw new Error("Invalid input");

  const { workspaceId, email, role } = parsed.data;
  const { user, membership } = await requireWorkspaceAccess(workspaceId);
  if (user.role !== "admin" && membership?.role !== "owner" && membership?.role !== "dealteam") {
    throw new Error("Only the deal team can add members.");
  }

  const target = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: { email: email.toLowerCase(), role: "member" }
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: target.id } },
    update: { role },
    create: { workspaceId, userId: target.id, role }
  });

  await logAudit({
    actorId: user.id,
    action: "workspace.member.add",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { addedEmail: target.email, role }
  });

  revalidatePath(`/deals/${workspaceId}`);
}
