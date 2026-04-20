import { RefreshPipedriveButton } from "./refresh-button";

type CustomField = { label: string; value: string };

export type PipedriveMeta = {
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
    customFields: CustomField[];
  } | null;
  dealCustomFields: CustomField[];
  lastSyncedAt: string;
};

function formatMoney(value: number | null, currency: string | null): string | null {
  if (typeof value !== "number") return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency ?? ""}`.trim();
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function KV({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-900">{value}</div>
    </div>
  );
}

export function PipedriveContext({
  workspaceId,
  meta
}: {
  workspaceId: string;
  meta: PipedriveMeta;
}) {
  const money = formatMoney(meta.value, meta.currency);
  const closeDate = formatDate(meta.expectedCloseDate);
  const probability = typeof meta.probability === "number" ? `${meta.probability}%` : null;
  const personLine =
    meta.person && (meta.person.name || meta.person.email)
      ? [meta.person.name, meta.person.email].filter(Boolean).join(" · ")
      : null;
  const ownerLine =
    meta.owner && (meta.owner.name || meta.owner.email)
      ? [meta.owner.name, meta.owner.email].filter(Boolean).join(" · ")
      : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Deal context
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            synced {new Date(meta.lastSyncedAt).toLocaleString("en-US")}
          </span>
          <RefreshPipedriveButton workspaceId={workspaceId} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4">
        <KV label="Stage" value={meta.stageName} />
        <KV label="Deal value" value={money} />
        <KV label="Expected close" value={closeDate} />
        <KV label="Probability" value={probability} />
        <KV label="Owner" value={ownerLine} />
        <KV label="Primary contact" value={personLine} />
        {meta.person?.phone ? <KV label="Phone" value={meta.person.phone} /> : null}
        <KV label="Organization" value={meta.organization?.name ?? null} />
        <KV label="Address" value={meta.organization?.address ?? null} />
        {meta.dealCustomFields.map((f) => (
          <KV key={`dcf-${f.label}`} label={f.label} value={f.value} />
        ))}
        {(meta.organization?.customFields ?? []).map((f) => (
          <KV key={`ocf-${f.label}`} label={f.label} value={f.value} />
        ))}
      </div>
    </section>
  );
}
