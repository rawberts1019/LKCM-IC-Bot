import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/access";
import { anthropic, MODEL } from "@/lib/anthropic";
import {
  ANSWER_TOOL,
  SYSTEM_PROMPT,
  buildChatRequest,
  extractPartialAnswer,
  maybeAutoTitleThread,
  persistChatTurn,
  type AnswerPayload
} from "@/lib/chat-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  workspaceId: z.string().min(1),
  threadId: z.string().optional(),
  question: z.string().trim().min(2).max(4000)
});

type Event =
  | { type: "meta"; threadId: string }
  | { type: "text"; content: string }
  | {
      type: "done";
      messageId: string;
      status: "sent" | "queued";
      confidence: number;
      sources: AnswerPayload["sources"];
    }
  | { type: "error"; code: string; message: string };

function encode(event: Event): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Invalid request body." },
      { status: 400 }
    );
  }

  let user, prepared;
  try {
    ({ user } = await requireWorkspaceAccess(body.workspaceId));
    prepared = await buildChatRequest({
      workspaceId: body.workspaceId,
      threadId: body.threadId,
      userId: user.id,
      question: body.question
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to prepare chat request." },
      { status: 400 }
    );
  }

  const { thread, apiMessages } = prepared;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encode({ type: "meta", threadId: thread.id }));

      let lastEmittedAnswer = "";
      let accumulatedJson = "";
      let payload: AnswerPayload | null = null;
      let permanentErrorReason: string | null = null;

      try {
        const messageStream = anthropic().messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: [ANSWER_TOOL],
          tool_choice: { type: "tool", name: "submit_answer" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: apiMessages as any
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "input_json_delta"
          ) {
            accumulatedJson += event.delta.partial_json;
            const current = extractPartialAnswer(accumulatedJson);
            if (current.length > lastEmittedAnswer.length) {
              const delta = current.slice(lastEmittedAnswer.length);
              lastEmittedAnswer = current;
              controller.enqueue(encode({ type: "text", content: delta }));
            }
          }
        }

        const finalMessage = await messageStream.finalMessage();
        const toolUse = finalMessage.content.find((b) => b.type === "tool_use");
        if (toolUse && toolUse.type === "tool_use") {
          payload = toolUse.input as AnswerPayload;
        } else {
          permanentErrorReason = "no_tool_use_in_response";
        }
      } catch (e) {
        // Transient failures — send a typed error event so the client can
        // show a retry prompt without persisting a garbage thread turn.
        if (e instanceof Anthropic.APIError) {
          if (e.status === 429) {
            controller.enqueue(
              encode({
                type: "error",
                code: "rate_limited",
                message:
                  "Claude is rate-limited for LKCM right now. Wait 30–60 seconds and ask again."
              })
            );
            controller.close();
            return;
          }
          if (e.status && e.status >= 500) {
            controller.enqueue(
              encode({
                type: "error",
                code: "service_unavailable",
                message: "Claude service error. Try again in a moment."
              })
            );
            controller.close();
            return;
          }
          if (e.status === 401 || e.status === 403) {
            controller.enqueue(
              encode({
                type: "error",
                code: "auth",
                message:
                  "Anthropic API key missing or invalid. Ask an admin to check ANTHROPIC_API_KEY in Vercel."
              })
            );
            controller.close();
            return;
          }
          permanentErrorReason =
            e.status === 400
              ? `anthropic_bad_request: ${e.message.slice(0, 200)}`
              : `anthropic_error_${e.status ?? "unknown"}`;
        } else if (e instanceof Error) {
          permanentErrorReason = e.message.slice(0, 200);
        } else {
          permanentErrorReason = "unknown_error";
        }
      }

      // Persist the turn (success or permanent-error path)
      try {
        const result = await persistChatTurn({
          workspaceId: body.workspaceId,
          userId: user.id,
          thread,
          question: body.question,
          payload,
          permanentErrorReason
        });
        // Auto-title the thread on the very first Q&A. Added to the response
        // time, but Haiku keeps this under 1-2s typical.
        if (payload) {
          await maybeAutoTitleThread({
            threadId: thread.id,
            question: body.question,
            answer: payload.answer
          });
        }
        controller.enqueue(
          encode({
            type: "done",
            messageId: result.assistantMessageId,
            status: result.shouldQueue ? "queued" : "sent",
            confidence: result.confidence,
            sources: result.sources
          })
        );
      } catch (e) {
        controller.enqueue(
          encode({
            type: "error",
            code: "persist_failed",
            message: e instanceof Error ? e.message : "Failed to save the answer."
          })
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
