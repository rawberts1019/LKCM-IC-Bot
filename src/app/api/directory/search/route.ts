import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { searchDirectory } from "@/lib/graph";

/**
 * Autocomplete suggestions for the Add-member form.
 *
 * Two sources, merged in order:
 *   1. Local User table — everyone who has signed into the app or been added
 *      to any deal. Always available; no Entra admin consent required.
 *   2. Microsoft Graph directory — only if the CTO has granted the
 *      User.Read.All application permission in Entra. Silently skipped if
 *      the Graph call fails (missing consent, auth issue, network).
 *
 * Results are de-duped by lowercased email; the local copy always wins so we
 * preserve the internal user id.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const local = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } }
      ]
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    take: 10
  });

  const results = local.map((u) => ({
    id: u.id,
    displayName: u.name,
    mail: u.email,
    jobTitle: null as string | null,
    source: "local" as const
  }));

  // Optional: merge in Graph hits if the tenant has granted User.Read.All.
  try {
    const graphHits = await searchDirectory(q, 10);
    const seen = new Set(results.map((r) => (r.mail ?? "").toLowerCase()));
    for (const g of graphHits) {
      const email = (g.mail ?? "").toLowerCase();
      if (!email || seen.has(email)) continue;
      results.push({
        id: g.id,
        displayName: g.displayName,
        mail: g.mail,
        jobTitle: g.jobTitle,
        source: "directory"
      });
      seen.add(email);
      if (results.length >= 10) break;
    }
  } catch {
    // Graph lookup not available (missing admin consent, etc.) — that's fine;
    // the local results still cover everyone the app has seen.
  }

  return NextResponse.json({ results });
}
