import { env } from "@/env";

/**
 * Minimal Pipedrive v1 API client. Manual-import flow only — no webhooks
 * (yet). API token is firm-wide, taken from env.
 *
 * Docs: https://developers.pipedrive.com/docs/api/v1
 */

const BASE = "https://api.pipedrive.com/v1";

export function isPipedriveConfigured(): boolean {
  return Boolean(env.PIPEDRIVE_API_KEY);
}

export type PipedriveDealSummary = {
  id: number;
  title: string;
  orgName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  stageName: string | null;
  value: number | null;
  currency: string | null;
  status: string;
  updateTime: string;
};

export type PipedriveDealDetail = PipedriveDealSummary & {
  ownerId: number | null;
  orgId: number | null;
};

type RawDeal = {
  id: number;
  title: string;
  org_name?: string | null;
  org_id?: number | { value?: number; name?: string } | null;
  user_id?:
    | number
    | {
        id?: number;
        name?: string | null;
        email?: string | null;
      }
    | null;
  owner_name?: string | null;
  stage_id?: number | null;
  value?: number | null;
  currency?: string | null;
  status: string;
  update_time: string;
};

type RawStage = { id: number; name: string };

async function fetchJson<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (!env.PIPEDRIVE_API_KEY) {
    throw new Error("PIPEDRIVE_API_KEY is not configured.");
  }
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("api_token", env.PIPEDRIVE_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pipedrive API error (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// Tiny in-process cache so we don't fetch the stage list on every request.
let stageCache: { at: number; stages: Map<number, string> } | null = null;
async function getStageMap(): Promise<Map<number, string>> {
  if (stageCache && Date.now() - stageCache.at < 5 * 60_000) {
    return stageCache.stages;
  }
  const data = await fetchJson<{ success: boolean; data: RawStage[] | null }>("/stages");
  const map = new Map<number, string>();
  for (const s of data.data ?? []) map.set(s.id, s.name);
  stageCache = { at: Date.now(), stages: map };
  return map;
}

function owner(raw: RawDeal["user_id"]): { id: number | null; name: string | null; email: string | null } {
  if (raw && typeof raw === "object") {
    return {
      id: raw.id ?? null,
      name: raw.name ?? null,
      email: raw.email ?? null
    };
  }
  return { id: typeof raw === "number" ? raw : null, name: null, email: null };
}

function toSummary(raw: RawDeal, stages: Map<number, string>): PipedriveDealSummary {
  const o = owner(raw.user_id);
  const orgName =
    raw.org_name ??
    (raw.org_id && typeof raw.org_id === "object" ? raw.org_id.name ?? null : null);
  return {
    id: raw.id,
    title: raw.title,
    orgName,
    ownerName: o.name,
    ownerEmail: o.email,
    stageName: raw.stage_id ? stages.get(raw.stage_id) ?? null : null,
    value: raw.value ?? null,
    currency: raw.currency ?? null,
    status: raw.status,
    updateTime: raw.update_time
  };
}

/**
 * Returns open Pipedrive deals, most-recently-updated first. We don't paginate
 * — 50 most recent is plenty for the import picker.
 */
export async function listOpenDeals(search?: string): Promise<PipedriveDealSummary[]> {
  const stages = await getStageMap();

  if (search && search.trim().length >= 2) {
    const res = await fetchJson<{
      success: boolean;
      data: { items: { item: RawDeal }[] } | null;
    }>("/deals/search", {
      term: search.trim(),
      status: "open",
      fields: "title,custom_fields,notes",
      limit: 20
    });
    const items = res.data?.items ?? [];
    return items.map((i) => toSummary(i.item, stages));
  }

  const res = await fetchJson<{ success: boolean; data: RawDeal[] | null }>("/deals", {
    status: "open",
    sort: "update_time DESC",
    limit: 50
  });
  return (res.data ?? []).map((d) => toSummary(d, stages));
}

export async function getDeal(id: number): Promise<PipedriveDealDetail | null> {
  const stages = await getStageMap();
  const res = await fetchJson<{ success: boolean; data: RawDeal | null }>(`/deals/${id}`);
  if (!res.data) return null;
  const summary = toSummary(res.data, stages);
  const o = owner(res.data.user_id);
  const orgId =
    res.data.org_id && typeof res.data.org_id === "object"
      ? res.data.org_id.value ?? null
      : typeof res.data.org_id === "number"
        ? res.data.org_id
        : null;
  return { ...summary, ownerId: o.id, orgId };
}

export function dealUrl(dealId: number): string | null {
  if (!env.PIPEDRIVE_COMPANY_DOMAIN) return null;
  return `https://${env.PIPEDRIVE_COMPANY_DOMAIN}.pipedrive.com/deal/${dealId}`;
}
