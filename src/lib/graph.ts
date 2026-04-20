import { env } from "@/env";

/**
 * Microsoft Graph integration for directory lookup.
 *
 * Uses application (not delegated) credentials — the app has its own
 * User.Read.All permission, granted by admin consent. Keeps the flow simple:
 * no per-user token refresh, works for any authenticated LKCM user.
 *
 * Requires: AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET, AZURE_AD_TENANT_ID
 * plus Graph application permission User.Read.All with admin consent.
 */

type CachedToken = { token: string; expiresAt: number } | null;
let cachedToken: CachedToken = null;

async function getAppAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.AZURE_AD_CLIENT_ID,
        client_secret: env.AZURE_AD_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph token request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
  return cachedToken.token;
}

export type DirectoryUser = {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string | null;
  jobTitle: string | null;
};

/**
 * Searches the LKCM Entra directory for users whose displayName or mail
 * starts with the query. Case-insensitive.
 */
export async function searchDirectory(query: string, limit = 10): Promise<DirectoryUser[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const token = await getAppAccessToken();

  const escaped = q.replace(/'/g, "''");
  const url = new URL("https://graph.microsoft.com/v1.0/users");
  url.searchParams.set(
    "$filter",
    `startswith(displayName,'${escaped}') or startswith(mail,'${escaped}') or startswith(userPrincipalName,'${escaped}')`
  );
  url.searchParams.set("$select", "id,displayName,mail,userPrincipalName,jobTitle");
  url.searchParams.set("$top", String(limit));
  url.searchParams.set("$orderby", "displayName");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph directory search failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { value: DirectoryUser[] };
  // Mail is sometimes null for unlicensed / shared accounts; fall back to UPN.
  return data.value.map((u) => ({
    ...u,
    mail: u.mail ?? u.userPrincipalName
  }));
}
