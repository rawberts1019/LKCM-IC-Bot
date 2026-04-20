"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { anthropic, MODEL } from "@/lib/anthropic";
import { buildChatRequest } from "@/lib/chat-runtime";

const severityEnum = z.enum(["high", "medium", "low"]);
const statusEnum = z.enum(["open", "mitigated", "accepted"]);

const addSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(2000),
  severity: severityEnum.default("medium")
});

export async function addRisk(input: z.infer<typeof addSchema>): Promise<void> {
  const parsed = addSchema.parse(input);
  const { user } = await requireWorkspaceAccess(parsed.workspaceId);

  const risk = await prisma.risk.create({
    data: {
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      description: parsed.description,
      severity: parsed.severity,
      createdById: user.id
    }
  });

  await logAudit({
    actorId: user.id,
    action: "risk.add",
    targetType: "risk",
    targetId: risk.id,
    workspaceId: parsed.workspaceId,
    metadata: { severity: parsed.severity }
  });

  revalidatePath(`/deals/${parsed.workspaceId}`);
}

const updateSchema = z.object({
  workspaceId: z.string().min(1),
  riskId: z.string().min(1),
  status: statusEnum.optional(),
  severity: severityEnum.optional(),
  mitigationNote: z.string().max(2000).optional()
});

export async function updateRisk(input: z.infer<typeof updateSchema>): Promise<void> {
  const parsed = updateSchema.parse(input);
  const { user } = await requireWorkspaceAccess(parsed.workspaceId);

  const risk = await prisma.risk.findFirst({
    where: { id: parsed.riskId, workspaceId: parsed.workspaceId }
  });
  if (!risk) throw new Error("Risk not found.");

  await prisma.risk.update({
    where: { id: risk.id },
    data: {
      status: parsed.status,
      severity: parsed.severity,
      mitigationNote: parsed.mitigationNote
    }
  });

  await logAudit({
    actorId: user.id,
    action: "risk.update",
    targetType: "risk",
    targetId: risk.id,
    workspaceId: parsed.workspaceId,
    metadata: {
      status: parsed.status,
      severity: parsed.severity
    }
  });

  revalidatePath(`/deals/${parsed.workspaceId}`);
}

const deleteSchema = z.object({
  workspaceId: z.string().min(1),
  riskId: z.string().min(1)
});

export async function deleteRisk(input: z.infer<typeof deleteSchema>): Promise<void> {
  const parsed = deleteSchema.parse(input);
  const { user } = await requireWorkspaceAccess(parsed.workspaceId);

  const risk = await prisma.risk.findFirst({
    where: { id: parsed.riskId, workspaceId: parsed.workspaceId }
  });
  if (!risk) return;

  await prisma.risk.delete({ where: { id: risk.id } });

  await logAudit({
    actorId: user.id,
    action: "risk.delete",
    targetType: "risk",
    targetId: risk.id,
    workspaceId: parsed.workspaceId
  });

  revalidatePath(`/deals/${parsed.workspaceId}`);
}

const EXTRACT_TOOL = {
  name: "submit_risks",
  description: "Return the list of material risks identified in the documents.",
  input_schema: {
    type: "object" as const,
    properties: {
      risks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "5-10 word title naming the risk."
            },
            description: {
              type: "string",
              description:
                "1-3 sentences explaining the risk and the source document(s) / page(s) it came from."
            },
            severity: {
              type: "string",
              enum: ["high", "medium", "low"],
              description:
                "High = existential / deal-breaker. Medium = material but manageable. Low = noted but minor."
            }
          },
          required: ["title", "description", "severity"]
        }
      }
    },
    required: ["risks"]
  }
};

const EXTRACT_SYSTEM = `You are an IC diligence assistant extracting risks from deal documents for LKCM Headwater Investments.

RULES:
1. Read the attached documents and surface every material risk that a reasonable IC member would want on the risk register.
2. Base each risk strictly on the documents — do NOT speculate or pull from outside knowledge.
3. Prefer concrete, specific risks ("Top customer represents 34% of revenue and contract expires 2026") over vague ones ("customer concentration").
4. Skip immaterial or boilerplate risks unless they are unusual for the industry.
5. Assign severity: high = could kill the deal or cause material loss; medium = manageable with diligence; low = worth tracking.
6. Call submit_risks with the list. If no material risks are identifiable from the documents, return an empty array.`;

const extractSchema = z.object({
  workspaceId: z.string().min(1)
});

export async function extractRisks(
  input: z.infer<typeof extractSchema>
): Promise<{ added: number }> {
  const parsed = extractSchema.parse(input);
  const { user } = await requireWorkspaceAccess(parsed.workspaceId);

  // Leverage the existing pipeline — same doc blocks, same prompt-caching
  // benefit across multiple analyst operations.
  const prepared = await buildChatRequest({
    workspaceId: parsed.workspaceId,
    userId: user.id,
    question: "Extract material risks from the attached documents for the IC risk register."
  });

  let response;
  try {
    response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: EXTRACT_SYSTEM,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "submit_risks" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: prepared.apiMessages as any
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError && e.status === 429) {
      throw new Error(
        "Claude is rate-limited right now. Wait 30-60 seconds and try again."
      );
    }
    throw new Error(
      e instanceof Error ? e.message : "Risk extraction failed."
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return structured risks.");
  }
  const extracted = toolUse.input as {
    risks: Array<{ title: string; description: string; severity: "high" | "medium" | "low" }>;
  };

  if (!extracted.risks || extracted.risks.length === 0) {
    return { added: 0 };
  }

  await prisma.risk.createMany({
    data: extracted.risks.map((r) => ({
      workspaceId: parsed.workspaceId,
      title: r.title.slice(0, 200),
      description: r.description.slice(0, 2000),
      severity: r.severity,
      createdById: user.id
    }))
  });

  await logAudit({
    actorId: user.id,
    action: "risk.extract",
    targetType: "workspace",
    targetId: parsed.workspaceId,
    workspaceId: parsed.workspaceId,
    metadata: { count: extracted.risks.length }
  });

  revalidatePath(`/deals/${parsed.workspaceId}`);
  return { added: extracted.risks.length };
}
