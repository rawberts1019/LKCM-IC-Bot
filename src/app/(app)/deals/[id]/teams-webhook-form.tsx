"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTeamsWebhook, testTeamsWebhook } from "./teams-actions";

export function TeamsWebhookForm({
  workspaceId,
  initialUrl,
  firmDefaultConfigured
}: {
  workspaceId: string;
  initialUrl: string | null;
  firmDefaultConfigured: boolean;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    startTransition(async () => {
      try {
        await setTeamsWebhook({
          workspaceId,
          url: url.trim() ? url.trim() : null
        });
        setStatus(url.trim() ? "Saved." : "Cleared (will use firm default).");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  function handleTest() {
    setError(null);
    setStatus("Sending test…");
    startTransition(async () => {
      try {
        const result = await testTeamsWebhook({ workspaceId });
        setStatus(
          result.posted
            ? "Test posted. Check the Teams channel."
            : `Not posted: ${result.reason ?? "no webhook"}`
        );
      } catch (e) {
        setStatus(null);
        setError(e instanceof Error ? e.message : "Test failed.");
      }
    });
  }

  const usingDefault = !initialUrl && firmDefaultConfigured;

  return (
    <form onSubmit={handleSave} className="space-y-2 text-sm">
      <div>
        <label className="block text-xs font-medium text-slate-700">
          Teams webhook URL (per-deal override)
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            firmDefaultConfigured
              ? "leave blank to use firm-wide default"
              : "https://<tenant>.webhook.office.com/…"
          }
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          disabled={isPending}
        />
        <p className="mt-1 text-xs text-slate-500">
          Paste a Teams Workflow / Incoming Webhook URL to route this deal&apos;s notifications
          to a dedicated channel.
          {usingDefault ? " Currently using firm default." : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:bg-slate-300"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={isPending}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Send test message
        </button>
        {status ? <span className="text-xs text-slate-600">{status}</span> : null}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    </form>
  );
}
