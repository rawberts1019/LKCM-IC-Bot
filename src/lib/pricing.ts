/**
 * Anthropic pricing for estimated cost display in /admin/usage.
 * Per-million-token rates in USD.
 *
 * Numbers are conservative defaults; refresh if Anthropic's pricing page
 * moves. Only used for ballparking — not for invoicing.
 *
 * Pricing reference (as of early 2026):
 *   Sonnet 4.x  : input $3 / 1M, output $15 / 1M
 *                 cache creation $3.75 / 1M, cache read $0.30 / 1M
 *   Haiku 4.5   : input $1 / 1M, output $5 / 1M
 *                 cache creation $1.25 / 1M, cache read $0.10 / 1M
 */

type ModelRates = {
  inputPerM: number;
  outputPerM: number;
  cacheCreatePerM: number;
  cacheReadPerM: number;
};

const RATES: Record<string, ModelRates> = {
  "claude-sonnet-4-6": {
    inputPerM: 3,
    outputPerM: 15,
    cacheCreatePerM: 3.75,
    cacheReadPerM: 0.3
  },
  "claude-haiku-4-5-20251001": {
    inputPerM: 1,
    outputPerM: 5,
    cacheCreatePerM: 1.25,
    cacheReadPerM: 0.1
  }
};

// Default we fall back to if an unknown model shows up.
const DEFAULT_RATES: ModelRates = RATES["claude-sonnet-4-6"];

export function estimateCostUsd(usage: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
  model?: string;
}): number {
  const r = (usage.model && RATES[usage.model]) || DEFAULT_RATES;
  const inT = usage.inputTokens ?? 0;
  const outT = usage.outputTokens ?? 0;
  const cacheCreate = usage.cacheCreationTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  return (
    (inT * r.inputPerM +
      outT * r.outputPerM +
      cacheCreate * r.cacheCreatePerM +
      cacheRead * r.cacheReadPerM) /
    1_000_000
  );
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: n >= 100 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(n);
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
