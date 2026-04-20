"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";
import { getObjectBytes } from "@/lib/storage";
import { env } from "@/env";

const askSchema = z.object({
  question: z.string().trim().min(2).max(4000),
  threadId: z.string().optional()
});

type AnswerPayload = {
  answer: string;
  confidence: number;
  sensitivity_flagged: boolean;
  sources: Array<{ filename: string; page?: number; snippet?: string }>;
};

const SYSTEM_PROMPT = `You are the LKCM Investment Committee assistant. You answer questions about a specific deal using ONLY the documents provided to you in this conversation.

RULES:
1. Base every answer on the provided documents. If a fact isn't in the documents, say so — do not speculate or use outside knowledge.
2. Be concise and direct. IC members have limited time. Lead with the answer, then supporting detail.
3. For quantitative questions, quote exact numbers from the documents. Flag if figures disagree across sources.
4. When you reference a claim, include the filename (and page number if you can tell) in your citations.

You MUST call the submit_answer tool with your response — never reply in free text. Fields:
- answer: the response to the user, written in concise markdown. End with a short "Sources:" section if you have any.
- confidence: your calibrated confidence on a 0.0 to 1.0 scale that the answer is correct given the documents.
  - 0.9+ = you found direct, unambiguous support in the documents
  - 0.6-0.9 = supported but requires inference or synthesis across sections
  - Below 0.6 = not well supported, or the documents are silent / contradictory
- sensitivity_flagged: true if the question or answer touches on pending litigation, IP/trade-secret disputes, personnel matters, material non-public information handling, or anything a reasonable compliance officer would want to review before you answer.
- sources: concrete citations for each claim, with filename, page (if known), and a short snippet of the referenced text.`;

const ANSWER_TOOL = {
  name: "submit_answer",
  description: "Submit your answer to the user's question. You must always use this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      sensitivity_flagged: { type: "boolean" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            filename: { type: "string" },
            page: { type: "number" },
            snippet: { type: "string" }
          },
          required: ["filename"]
        }
      }
    },
    required: ["answer", "confidence", "sensitivity_flagged", "sources"]
  }
};

export async function askQuestion(workspaceId: string, formData: FormData): Promise<void> {
  const { user } = await requireWorkspaceAccess(workspaceId);

  const parsed = askSchema.safeParse({
    question: formData.get("question"),
    threadId: formData.get("threadId") || undefined
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  const { question, threadId } = parsed.data;

  const documents = await prisma.document.findMany({
    where: { workspaceId, status: "ready" },
    orderBy: { createdAt: "asc" }
  });

  if (documents.length === 0) {
    throw new Error("Upload at least one document before asking questions.");
  }

  // Create or load thread
  let thread = threadId
    ? await prisma.thread.findFirst({ where: { id: threadId, workspaceId } })
    : null;
  if (!thread) {
    thread = await prisma.thread.create({
      data: {
        workspaceId,
        createdById: user.id,
        title: question.slice(0, 80)
      }
    });
  }

  // Load thread history. We intentionally do NOT save the user's question yet
  // — if the LLM call fails with a transient error we throw back to the
  // composer and leave the thread untouched.
  const history = await prisma.message.findMany({
    where: { threadId: thread.id, status: { in: ["sent", "superseded"] } },
    orderBy: { createdAt: "asc" }
  });

  // Pull all ready-state documents and base64-encode them
  const docContent = await Promise.all(
    documents.map(async (d) => {
      const bytes = await getObjectBytes(d.storageKey);
      const base64 = Buffer.from(bytes).toString("base64");
      return {
        doc: d,
        block: {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64
          },
          title: d.filename,
          cache_control: { type: "ephemeral" as const }
        }
      };
    })
  );

  // Build the user turn: documents first, then recap of prior turns as text, then new question
  const priorTurnsAsText = history
    .map((m) => {
      const who =
        m.role === "user" ? "User previously asked" : m.role === "dealteam" ? "Deal team noted" : "You previously answered";
      return `${who}: ${m.content}`;
    })
    .join("\n\n");

  const apiMessages = [
    {
      role: "user" as const,
      content: [
        ...docContent.map((d) => d.block),
        ...(priorTurnsAsText
          ? [{ type: "text" as const, text: `Prior conversation in this thread:\n${priorTurnsAsText}` }]
          : []),
        { type: "text" as const, text: `Current question: ${question}` }
      ]
    }
  ];

  // Call Claude. Transient errors (rate limit, 5xx, auth, network) throw back
  // to the composer so the user can retry — nothing is saved to the thread.
  // Permanent / unknown errors fall through and get persisted as a queued
  // message so the deal team can take over.
  let payload: AnswerPayload | null = null;
  let permanentErrorReason: string | null = null;
  try {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [ANSWER_TOOL],
      tool_choice: { type: "tool", name: "submit_answer" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: apiMessages as any
    });
    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Model did not return a structured answer.");
    }
    payload = toolUse.input as AnswerPayload;
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      if (e.status === 429) {
        throw new Error(
          "Claude is rate-limited for LKCM right now. Wait 30–60 seconds and ask again. Large PDFs burn through the per-minute token quota fast — trim the corpus if this keeps happening."
        );
      }
      if (e.status && e.status >= 500) {
        throw new Error("Claude service error. Try again in a moment.");
      }
      if (e.status === 401 || e.status === 403) {
        throw new Error(
          "Anthropic API key missing or invalid. Ask an admin to check ANTHROPIC_API_KEY in Vercel."
        );
      }
      if (e.status === 400) {
        // Bad request — often a too-large payload. Persist so the team can see.
        permanentErrorReason = `anthropic_bad_request: ${e.message.slice(0, 200)}`;
      } else {
        permanentErrorReason = `anthropic_error_${e.status ?? "unknown"}`;
      }
    } else if (e instanceof Error) {
      // Unknown error — persist for review but don't leak the raw message to IC.
      permanentErrorReason = e.message.slice(0, 200);
    } else {
      permanentErrorReason = "unknown_error";
    }
  }

  // Decide routing
  const threshold = env.CONFIDENCE_AUTO_SEND_THRESHOLD;
  const shouldQueue =
    !payload || payload.confidence < threshold || payload.sensitivity_flagged;

  const answerText =
    payload?.answer ??
    "I wasn't able to produce an answer to this — the deal team will take a look and get back to you.";

  const sourcesJson = payload
    ? { sources: payload.sources, confidence: payload.confidence, sensitivityFlagged: payload.sensitivity_flagged }
    : { sources: [], confidence: 0, sensitivityFlagged: true, error: permanentErrorReason };

  // Now that we're committing to persist this turn, save the user message
  // followed by the assistant message so they appear together in the thread.
  const userMessage = await prisma.message.create({
    data: {
      threadId: thread.id,
      role: "user",
      content: question,
      createdById: user.id
    }
  });

  await logAudit({
    actorId: user.id,
    action: "message.ask",
    targetType: "message",
    targetId: userMessage.id,
    workspaceId,
    metadata: { threadId: thread.id }
  });

  const assistantMessage = await prisma.message.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      status: shouldQueue ? "queued" : "sent",
      content: answerText,
      citationsJson: sourcesJson,
      confidence: payload?.confidence ?? 0,
      sensitivityFlagged: payload?.sensitivity_flagged ?? true
    }
  });

  if (shouldQueue) {
    const reason = !payload
      ? "llm_error"
      : payload.sensitivity_flagged
        ? "sensitive_flag"
        : "low_confidence";
    await prisma.reviewQueueItem.create({
      data: {
        workspaceId,
        messageId: assistantMessage.id,
        reason,
        status: "pending"
      }
    });
  }

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() }
  });

  await logAudit({
    actorId: user.id,
    action: shouldQueue ? "message.answer.queued" : "message.answer.sent",
    targetType: "message",
    targetId: assistantMessage.id,
    workspaceId,
    metadata: {
      threadId: thread.id,
      confidence: payload?.confidence ?? 0,
      sensitivity_flagged: payload?.sensitivity_flagged ?? true
    }
  });

  revalidatePath(`/deals/${workspaceId}`);
  revalidatePath(`/deals/${workspaceId}/chat`);

  if (!threadId) {
    redirect(`/deals/${workspaceId}/chat?thread=${thread.id}`);
  }
}
