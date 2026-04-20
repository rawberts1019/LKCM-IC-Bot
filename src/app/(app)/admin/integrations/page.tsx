import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { env } from "@/env";
import { isPipedriveConfigured } from "@/lib/pipedrive";

export default async function AdminIntegrationsPage() {
  await requireAdmin();

  const baseUrl =
    env.NEXTAUTH_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "https://your-app.vercel.app";
  const webhookUrl = `${baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`}/api/webhooks/pipedrive`;
  const stagesConfigured = env.PIPEDRIVE_AUTO_PROVISION_STAGES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-700">
          &larr; Admin
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-slate-600">
          Status of external systems the bot talks to.
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Microsoft Teams</h2>
          <StatusPill ok={Boolean(env.TEAMS_DEFAULT_WEBHOOK_URL)} />
        </div>
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          <Row
            label="Firm-wide webhook URL"
            ok={Boolean(env.TEAMS_DEFAULT_WEBHOOK_URL)}
            notes="env TEAMS_DEFAULT_WEBHOOK_URL — used when a deal doesn't have its own override"
          />
        </div>
        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-slate-500">
            Teams webhook setup
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
            <li>In Teams, pick the channel you want notifications in.</li>
            <li>
              <em>⋯ menu on the channel → Workflows → Post to a channel when a webhook
              request is received</em>. (If your tenant still has the legacy Office 365
              connector, use <em>⋯ → Manage channel → Connectors → Incoming Webhook</em>.)
            </li>
            <li>Name the workflow (e.g. &quot;LKCM IC Bot&quot;), pick the channel, finish.</li>
            <li>Copy the generated URL.</li>
            <li>
              Paste it either as <code>TEAMS_DEFAULT_WEBHOOK_URL</code> in Vercel env vars
              (firm-wide default), or per-deal on the deal page. Redeploy after setting env.
            </li>
          </ol>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Pipedrive</h2>
          <StatusPill ok={isPipedriveConfigured()} />
        </div>
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          <Row
            label="API key"
            ok={isPipedriveConfigured()}
            notes="env PIPEDRIVE_API_KEY"
          />
          <Row
            label="Company domain"
            ok={Boolean(env.PIPEDRIVE_COMPANY_DOMAIN)}
            notes={`env PIPEDRIVE_COMPANY_DOMAIN — enables the "View in Pipedrive" link`}
          />
          <Row
            label="Webhook secret"
            ok={Boolean(env.PIPEDRIVE_WEBHOOK_SECRET)}
            notes="env PIPEDRIVE_WEBHOOK_SECRET — required to accept incoming webhooks"
          />
          <Row
            label="Auto-provision stages"
            ok={stagesConfigured.length > 0}
            notes={
              stagesConfigured.length > 0
                ? `Will auto-create a workspace when a deal reaches: ${stagesConfigured.join(", ")}`
                : "env PIPEDRIVE_AUTO_PROVISION_STAGES — optional"
            }
          />
        </div>

        <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="font-semibold uppercase tracking-wide text-slate-500">
            Pipedrive webhook setup
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
            <li>
              Pipedrive → <em>Settings → Tools and integrations → Webhooks → Add new webhook</em>.
            </li>
            <li>
              Event object: <code>deal</code>, Event action: <code>*</code>.
            </li>
            <li>
              Endpoint URL:
              <code className="ml-1 block rounded bg-white px-2 py-1 font-mono text-xs text-slate-800 border border-slate-200 mt-1">
                {webhookUrl}
              </code>
            </li>
            <li>
              HTTP Auth username: <code>pipedrive</code>.
            </li>
            <li>
              HTTP Auth password: the value of{" "}
              <code>PIPEDRIVE_WEBHOOK_SECRET</code> from Vercel env.
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {ok ? "configured" : "not configured"}
    </span>
  );
}

function Row({
  label,
  ok,
  notes
}: {
  label: string;
  ok: boolean;
  notes: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        <div className="text-xs text-slate-500">{notes}</div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
        }`}
      >
        {ok ? "set" : "unset"}
      </span>
    </div>
  );
}
