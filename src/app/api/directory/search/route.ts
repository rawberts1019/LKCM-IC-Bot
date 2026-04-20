import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchDirectory } from "@/lib/graph";

/**
 * Returns autocomplete suggestions from the LKCM Entra directory.
 * Access-gated: user must be signed in (middleware enforces). We don't scope
 * by workspace here — the directory is firm-wide, and the write (addMember)
 * is where workspace authorization is checked.
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

  try {
    const results = await searchDirectory(q);
    return NextResponse.json({
      results: results.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        mail: u.mail,
        jobTitle: u.jobTitle
      }))
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Directory lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
