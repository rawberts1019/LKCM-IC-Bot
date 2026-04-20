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

// ---------------------------------------------------------------------------
// Rich deal metadata (custom fields, organization detail, owner/person,
// expected close, probability, etc). Used to populate the deal page context
// panel. Separate from the import path — we call this on refresh/sync too.
// ---------------------------------------------------------------------------

type PipedriveField = {
  key: string;
  name: string;
  field_type: string; // "varchar" | "text" | "date" | "monetary" | "enum" | "set" | "user" | "people" | "org" | "address" | "phone" | ...
  options?: Array<{ id: number; label: string }>;
};

type FieldSchema = {
  at: number;
  deal: Map<string, PipedriveField>;
  org: Map<string, PipedriveField>;
};

let fieldSchemaCache: FieldSchema | null = null;

async function getFieldSchemas(): Promise<FieldSchema> {
  if (fieldSchemaCache && Date.now() - fieldSchemaCache.at < 10 * 60_000) {
    return fieldSchemaCache;
  }
  const [dealRes, orgRes] = await Promise.all([
    fetchJson<{ success: boolean; data: PipedriveField[] | null }>("/dealFields"),
    fetchJson<{ success: boolean; data: PipedriveField[] | null }>("/organizationFields")
  ]);
  const toMap = (fields: PipedriveField[] | null) =>
    new Map((fields ?? []).map((f) => [f.key, f]));
  fieldSchemaCache = {
    at: Date.now(),
    deal: toMap(dealRes.data),
    org: toMap(orgRes.data)
  };
  return fieldSchemaCache;
}

type PipedriveOrg = {
  id: number;
  name: string;
  address?: string | null;
  address_formatted_address?: string | null;
  people_count?: number | null;
  owner_id?: { name?: string | null } | number | null;
  [key: string]: unknown;
};

async function getOrganization(id: number): Promise<PipedriveOrg | null> {
  try {
    const res = await fetchJson<{ success: boolean; data: PipedriveOrg | null }>(
      `/organizations/${id}`
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

// Pipedrive returns custom enum/set values as IDs; look up the label.
function resolveEnumValue(
  raw: unknown,
  field: PipedriveField
): string | null {
  if (raw == null || raw === "") return null;
  const values = String(raw).split(",").map((v) => v.trim());
  const labels = values
    .map((v) => field.options?.find((o) => String(o.id) === v)?.label ?? null)
    .filter((v): v is string => v !== null);
  return labels.length ? labels.join(", ") : null;
}

function formatFieldValue(raw: unknown, field: PipedriveField): string | null {
  if (raw == null || raw === "") return null;

  switch (field.field_type) {
    case "enum":
    case "set":
      return resolveEnumValue(raw, field);
    case "date":
      // Pipedrive returns ISO dates; render as MMM d, yyyy.
      try {
        const d = new Date(String(raw));
        if (isNaN(d.getTime())) return null;
        return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      } catch {
        return null;
      }
    case "daterange": {
      if (typeof raw === "object" && raw) {
        const o = raw as { start?: string; end?: string };
        if (o.start && o.end) return `${o.start} → ${o.end}`;
      }
      return null;
    }
    case "monetary": {
      if (typeof raw === "object" && raw) {
        const o = raw as { value?: number; currency?: string };
        if (typeof o.value === "number") {
          try {
            return new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: o.currency ?? "USD",
              maximumFractionDigits: 0
            }).format(o.value);
          } catch {
            return `${o.value.toLocaleString()} ${o.currency ?? ""}`.trim();
          }
        }
      }
      if (typeof raw === "number") return raw.toLocaleString();
      return String(raw);
    }
    case "people":
    case "user":
    case "org": {
      if (typeof raw === "object" && raw) {
        const o = raw as { name?: string; email?: string };
        return o.name ?? o.email ?? null;
      }
      return null;
    }
    case "address": {
      if (typeof raw === "object" && raw) {
        const o = raw as { formatted_address?: string; value?: string };
        return o.formatted_address ?? o.value ?? null;
      }
      return String(raw);
    }
    case "phone": {
      if (Array.isArray(raw)) {
        const first = raw.find((p) => p?.primary) ?? raw[0];
        return first?.value ?? null;
      }
      return typeof raw === "string" ? raw : null;
    }
    case "email": {
      if (Array.isArray(raw)) {
        const first = raw.find((p) => p?.primary) ?? raw[0];
        return first?.value ?? null;
      }
      return typeof raw === "string" ? raw : null;
    }
    default:
      if (typeof raw === "string" || typeof raw === "number") return String(raw);
      return null;
  }
}

// Built-in deal/org field keys we render explicitly (not as custom fields).
const BUILT_IN_SKIP = new Set([
  "id",
  "title",
  "value",
  "currency",
  "status",
  "stage_id",
  "pipeline_id",
  "user_id",
  "person_id",
  "org_id",
  "org_name",
  "person_name",
  "owner_name",
  "cc_email",
  "creator_user_id",
  "update_time",
  "add_time",
  "stage_change_time",
  "next_activity_date",
  "next_activity_time",
  "next_activity_subject",
  "next_activity_type",
  "next_activity_duration",
  "next_activity_note",
  "next_activity_id",
  "last_activity_date",
  "last_activity_id",
  "last_incoming_mail_time",
  "last_outgoing_mail_time",
  "expected_close_date",
  "probability",
  "lost_reason",
  "visible_to",
  "close_time",
  "won_time",
  "first_won_time",
  "lost_time",
  "products_count",
  "files_count",
  "notes_count",
  "followers_count",
  "email_messages_count",
  "activities_count",
  "done_activities_count",
  "undone_activities_count",
  "participants_count",
  "reference_activities_count",
  "label",
  "label_ids",
  "stage_order_nr",
  "formatted_value",
  "weighted_value",
  "formatted_weighted_value",
  "weighted_value_currency",
  "rotten_time",
  "active",
  "deleted",
  "origin",
  "origin_id",
  "channel",
  "channel_id",
  "acv",
  "arr",
  "mrr",
  "acv_currency",
  "arr_currency",
  "mrr_currency"
]);

function extractCustomFields(
  raw: Record<string, unknown>,
  schema: Map<string, PipedriveField>
): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(raw)) {
    if (BUILT_IN_SKIP.has(key)) continue;
    const field = schema.get(key);
    if (!field) continue; // unknown key — skip
    const formatted = formatFieldValue(value, field);
    if (formatted) out.push({ label: field.name, value: formatted });
  }
  // Keep deterministic order by label
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export type PipedriveMetadata = {
  value: number | null;
  currency: string | null;
  stageName: string | null;
  expectedCloseDate: string | null;
  probability: number | null;
  dealLabel: string | null;
  owner: { name: string | null; email: string | null } | null;
  person: { name: string | null; email: string | null; phone: string | null } | null;
  organization: {
    name: string | null;
    address: string | null;
    peopleCount: number | null;
    customFields: Array<{ label: string; value: string }>;
  } | null;
  dealCustomFields: Array<{ label: string; value: string }>;
  lastSyncedAt: string;
};

function extractPerson(
  raw: Record<string, unknown>
): PipedriveMetadata["person"] {
  const p = raw.person_id as
    | { name?: string; email?: { value?: string; primary?: boolean }[]; phone?: { value?: string; primary?: boolean }[] }
    | number
    | null
    | undefined;
  if (!p || typeof p !== "object") return null;
  const primaryOrFirst = <T extends { primary?: boolean; value?: string }>(arr?: T[]) => {
    if (!arr?.length) return null;
    return arr.find((e) => e.primary)?.value ?? arr[0].value ?? null;
  };
  return {
    name: p.name ?? null,
    email: primaryOrFirst(p.email),
    phone: primaryOrFirst(p.phone)
  };
}

export async function getDealMetadata(dealId: number): Promise<PipedriveMetadata | null> {
  const [detail, schemas] = await Promise.all([
    fetchJson<{ success: boolean; data: Record<string, unknown> | null }>(`/deals/${dealId}`),
    getFieldSchemas()
  ]);
  if (!detail.data) return null;
  const raw = detail.data;
  const stages = await getStageMap();

  const o = owner(raw.user_id as RawDeal["user_id"]);
  const orgRefId =
    typeof raw.org_id === "object" && raw.org_id
      ? (raw.org_id as { value?: number }).value ?? null
      : typeof raw.org_id === "number"
        ? raw.org_id
        : null;

  const [org, orgDetail] = orgRefId
    ? [raw.org_id, await getOrganization(orgRefId)]
    : [null, null];

  const orgCustomFields = orgDetail
    ? extractCustomFields(orgDetail as unknown as Record<string, unknown>, schemas.org)
    : [];

  return {
    value: typeof raw.value === "number" ? raw.value : null,
    currency: typeof raw.currency === "string" ? raw.currency : null,
    stageName:
      typeof raw.stage_id === "number" ? stages.get(raw.stage_id) ?? null : null,
    expectedCloseDate:
      typeof raw.expected_close_date === "string" ? raw.expected_close_date : null,
    probability: typeof raw.probability === "number" ? raw.probability : null,
    dealLabel: typeof raw.label === "string" ? raw.label : null,
    owner: o.name || o.email ? { name: o.name, email: o.email } : null,
    person: extractPerson(raw),
    organization: orgDetail
      ? {
          name: orgDetail.name ?? null,
          address:
            (orgDetail.address_formatted_address as string | null) ??
            (orgDetail.address as string | null) ??
            null,
          peopleCount: (orgDetail.people_count as number | null) ?? null,
          customFields: orgCustomFields
        }
      : org && typeof org === "object"
        ? {
            name: (org as { name?: string }).name ?? null,
            address: null,
            peopleCount: null,
            customFields: []
          }
        : null,
    dealCustomFields: extractCustomFields(raw, schemas.deal),
    lastSyncedAt: new Date().toISOString()
  };
}
