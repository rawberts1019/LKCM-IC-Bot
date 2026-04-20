import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access";
import { env } from "@/env";
import { isPipedriveConfigured, listOpenDeals } from "@/lib/pipedrive";

export const runtime = "nodejs";

/**
 * Admin-only diagnostic for the Pipedrive integration. Tells you whether the
 * server sees the env var and whether a basic API call succeeds.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();

  const keyPresent = Boolean(env.PIPEDRIVE_API_KEY);
  const domainPresent = Boolean(env.PIPEDRIVE_COMPANY_DOMAIN);

  if (!keyPresent) {
    return NextResponse.json({
      ok: false,
      configured: false,
      keyPresent,
      domainPresent,
      reason:
        "PIPEDRIVE_API_KEY is not set. Add it in Vercel Project → Settings → Environment Variables and redeploy."
    });
  }

  if (!isPipedriveConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      keyPresent,
      domainPresent,
      reason: "Env var parsed as empty."
    });
  }

  try {
    const deals = await listOpenDeals();
    return NextResponse.json({
      ok: true,
      configured: true,
      keyPresent,
      domainPresent,
      sampleDealCount: deals.length,
      firstThreeTitles: deals.slice(0, 3).map((d) => d.title)
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      configured: true,
      keyPresent,
      domainPresent,
      reason: e instanceof Error ? e.message : "Pipedrive API request failed."
    });
  }
}
