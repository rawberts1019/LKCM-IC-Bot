import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPipedriveConfigured, listOpenDeals } from "@/lib/pipedrive";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!isPipedriveConfigured()) {
    return NextResponse.json({ error: "Pipedrive is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";

  try {
    const deals = await listOpenDeals(q);
    return NextResponse.json({
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        orgName: d.orgName,
        stageName: d.stageName,
        ownerName: d.ownerName,
        value: d.value,
        currency: d.currency
      }))
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Pipedrive request failed." },
      { status: 502 }
    );
  }
}
