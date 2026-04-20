import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it in Vercel env vars (Settings → Environment Variables)."
    );
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const MODEL = env.ANTHROPIC_MODEL;
