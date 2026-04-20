import type { Thread } from "@prisma/client";
import { prisma } from "./db";
import { getObjectBytes } from "./storage";
import { MIME_PDF } from "./extraction";
import { logAudit } from "./audit";
import { createNotifications, dealTeamMemberIds } from "./notifications";
import { env } from "@/env";

export const SYSTEM_PROMPT = `You are the LKCM Investment Committee assistant. You answer questions about a specific deal using ONLY the documents provided to you in this conversation.

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

export const ANSWER_TOOL = {
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

export type AnswerPayload = {
  answer: string;
  confidence: number;
  sensitivity_flagged: boolean;
  sources: Array<{ filename: string; page?: number; snippet?: string }>;
};

/**
 * Build the Anthropic messages array for a given question. Loads documents
 * (PDFs as base64 blocks, extracted text for other types), stitches in prior
 * conversation history as a recap paragraph, and appends the new question.
 *
 * Does NOT persist anything — caller decides whether to save based on result.
 */
export async function buildChatRequest(options: {
  workspaceId: string;
  threadId?: string;
  userId: string;
  question: string;
}) {
  const { workspaceId, threadId, userId, question } = options;

  const documents = await prisma.document.findMany({
    where: { workspaceId, status: "ready" },
    orderBy: { createdAt: "asc" }
  });
  if (documents.length === 0) {
    throw new Error("Upload at least one document before asking questions.");
  }

  let thread = threadId
    ? await prisma.thread.findFirst({ where: { id: threadId, workspaceId } })
    : null;
  const threadExisted = thread !== null;
  if (!thread) {
    thread = await prisma.thread.create({
      data: { workspaceId, createdById: userId, title: question.slice(0, 80) }
    });
  }

  const history = await prisma.message.findMany({
    where: { threadId: thread.id, status: { in: ["sent", "superseded"] } },
    orderBy: { createdAt: "asc" }
  });

  const docBlocks = await Promise.all(
    documents.map(async (d) => {
      if (d.mimeType === MIME_PDF) {
        const bytes = await getObjectBytes(d.storageKey);
        return {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: Buffer.from(bytes).toString("base64")
          },
          title: d.filename,
          cache_control: { type: "ephemeral" as const }
        };
      }
      const chunks = await prisma.documentChunk.findMany({
        where: { documentId: d.id },
        orderBy: { chunkIndex: "asc" },
        select: { content: true }
      });
      return {
        type: "document" as const,
        source: {
          type: "text" as const,
          media_type: "text/plain" as const,
          data: chunks.map((c) => c.content).join("") || "(this document was empty or could not be read)"
        },
        title: d.filename,
        cache_control: { type: "ephemeral" as const }
      };
    })
  );

  const priorTurnsAsText = history
    .map((m) => {
      const who =
        m.role === "user"
          ? "User previously asked"
          : m.role === "dealteam"
            ? "Deal team noted"
            : "You previously answered";
      return `${who}: ${m.content}`;
    })
    .join("\n\n");

  const apiMessages = [
    {
      role: "user" as const,
      content: [
        ...docBlocks,
        ...(priorTurnsAsText
          ? [{ type: "text" as const, text: `Prior conversation in this thread:\n${priorTurnsAsText}` }]
          : []),
        { type: "text" as const, text: `Current question: ${question}` }
      ]
    }
  ];

  return { thread, threadExisted, apiMessages };
}

/**
 * Persist the final state of a chat turn after the Anthropic call completes
 * (or fails). Handles the user message, the assistant message, review-queue
 * creation on low confidence / sensitivity / error, notifications, and
 * audit logging.
 */
export async function persistChatTurn(options: {
  workspaceId: string;
  userId: string;
  thread: Thread;
  question: string;
  payload: AnswerPayload | null;
  permanentErrorReason?: string | null;
}): Promise<{
  assistantMessageId: string;
  shouldQueue: boolean;
  answerText: string;
  confidence: number;
  sources: AnswerPayload["sources"];
}> {
  const { workspaceId, userId, thread, question, payload, permanentErrorReason } = options;

  const threshold = env.CONFIDENCE_AUTO_SEND_THRESHOLD;
  const shouldQueue = !payload || payload.confidence < threshold || payload.sensitivity_flagged;
  const answerText =
    payload?.answer ??
    "I wasn't able to produce an answer to this — the deal team will take a look and get back to you.";

  const sourcesJson = payload
    ? {
        sources: payload.sources,
        confidence: payload.confidence,
        sensitivityFlagged: payload.sensitivity_flagged
      }
    : {
        sources: [],
        confidence: 0,
        sensitivityFlagged: true,
        error: permanentErrorReason ?? "unknown"
      };

  const userMessage = await prisma.message.create({
    data: { threadId: thread.id, role: "user", content: question, createdById: userId }
  });

  await logAudit({
    actorId: userId,
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
      data: { workspaceId, messageId: assistantMessage.id, reason, status: "pending" }
    });

    const memberIds = (await dealTeamMemberIds(workspaceId)).filter((id) => id !== userId);
    if (memberIds.length > 0) {
      await createNotifications(
        memberIds.map((recipientId) => ({
          userId: recipientId,
          type: "review.new",
          title: "New question needs review",
          body: question.slice(0, 140),
          targetUrl: `/deals/${workspaceId}/review`,
          workspaceId
        }))
      );
    }
  }

  await prisma.thread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() }
  });

  await logAudit({
    actorId: userId,
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

  return {
    assistantMessageId: assistantMessage.id,
    shouldQueue,
    answerText,
    confidence: payload?.confidence ?? 0,
    sources: payload?.sources ?? []
  };
}

/**
 * Extract the `answer` string from an in-flight partial tool_use JSON payload.
 * Handles the fact that Claude streams the tool input as incremental JSON
 * text — we regex out the currently-known portion of the answer field so we
 * can show it progressively.
 */
export function extractPartialAnswer(partialJson: string): string {
  const m = partialJson.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)("|$)/);
  if (!m) return "";
  return m[1]
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\\//g, "/");
}
