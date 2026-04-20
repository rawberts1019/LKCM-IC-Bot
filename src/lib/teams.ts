import { prisma } from "./db";
import { env } from "@/env";

/**
 * Microsoft Teams "incoming webhook" integration. Posts Adaptive Cards to the
 * channel the URL is bound to. One-way only (bot → Teams) — good enough for
 * notifications; upgrading to a full @mention-able bot would require Azure
 * Bot Service.
 *
 * Setup in Teams:
 *   Channel → ⋯ → Manage channel → Connectors → Incoming Webhook → Add
 *   Name it, give it an avatar, copy the URL.
 * Paste into:
 *   TEAMS_DEFAULT_WEBHOOK_URL env (firm-wide fallback), or
 *   Workspace.teamsWebhookUrl (per-deal override, via admin UI)
 */

type AdaptiveAction = {
  type: "Action.OpenUrl";
  title: string;
  url: string;
};

type AdaptiveBlock = Record<string, unknown>;

type CardInput = {
  title: string;
  subtitle?: string;
  facts?: Array<{ title: string; value: string }>;
  body?: string;
  actions?: AdaptiveAction[];
  accent?: "good" | "warning" | "attention" | "default";
};

function buildCard(card: CardInput): Record<string, unknown> {
  const blocks: AdaptiveBlock[] = [
    {
      type: "TextBlock",
      size: "Medium",
      weight: "Bolder",
      text: card.title,
      wrap: true,
      color:
        card.accent === "warning"
          ? "Warning"
          : card.accent === "attention"
            ? "Attention"
            : card.accent === "good"
              ? "Good"
              : "Default"
    }
  ];
  if (card.subtitle) {
    blocks.push({
      type: "TextBlock",
      text: card.subtitle,
      wrap: true,
      isSubtle: true,
      spacing: "None"
    });
  }
  if (card.facts && card.facts.length > 0) {
    blocks.push({ type: "FactSet", facts: card.facts });
  }
  if (card.body) {
    blocks.push({
      type: "TextBlock",
      text: card.body,
      wrap: true,
      spacing: "Medium"
    });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: blocks,
          actions: card.actions ?? []
        }
      }
    ]
  };
}

/**
 * Resolves the webhook URL for a workspace: per-deal override wins, falls
 * back to the firm-wide env default. Returns null if neither is configured.
 */
export async function resolveTeamsWebhookUrl(workspaceId: string): Promise<string | null> {
  const row = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { teamsWebhookUrl: true }
  });
  if (row?.teamsWebhookUrl) return row.teamsWebhookUrl;
  return env.TEAMS_DEFAULT_WEBHOOK_URL ?? null;
}

/**
 * Post a card to Teams. Silently no-ops if no webhook URL is configured for
 * the workspace. Throws only on network / HTTP errors so callers can decide
 * whether to fail loud or swallow.
 */
export async function postToTeams(
  workspaceId: string,
  card: CardInput
): Promise<{ posted: boolean; reason?: string }> {
  const url = await resolveTeamsWebhookUrl(workspaceId);
  if (!url) return { posted: false, reason: "no webhook configured" };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCard(card))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Teams webhook failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return { posted: true };
}

/**
 * Fire-and-forget wrapper. Posts to Teams but never lets Teams failures break
 * the originating action (a review approval, a question landing in queue, etc.).
 * Best-effort only.
 */
export async function postToTeamsSafe(
  workspaceId: string,
  card: CardInput
): Promise<void> {
  try {
    await postToTeams(workspaceId, card);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[teams] post failed for ${workspaceId}:`,
      e instanceof Error ? e.message : e
    );
  }
}
