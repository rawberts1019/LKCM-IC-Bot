# Entra ID (Azure AD) setup

One-time setup to let the IC Bot sign users in via Microsoft Authenticator + LKCM SSO.

## 1. Create the App Registration

1. In the Azure portal, go to **Microsoft Entra ID → App registrations → New registration**.
2. Name: `LKCM IC Bot`.
3. Supported account types: **Accounts in this organizational directory only (LKCM only — single tenant)**.
4. Redirect URI: **Web** →
   - `http://localhost:3000/api/auth/callback/microsoft-entra-id` (development)
   - `https://<your-vercel-domain>/api/auth/callback/microsoft-entra-id` (production — add after first deploy)
5. Click **Register**.

## 2. Copy values into `.env`

From the app registration overview page:

| Azure value | `.env` variable |
|---|---|
| Application (client) ID | `AZURE_AD_CLIENT_ID` |
| Directory (tenant) ID | `AZURE_AD_TENANT_ID` |

Then **Certificates & secrets → New client secret**, copy the value (not the ID) into `AZURE_AD_CLIENT_SECRET`. Set an expiry of **6 months** for the prototype; rotate before pilot.

## 3. Configure API permissions

1. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Add: `openid`, `profile`, `email`, `offline_access`, `User.Read`.
3. Click **Grant admin consent for LKCM**.

### Directory autocomplete (optional — requires Global Admin consent)

The Add-member form suggests people as you type. By default, suggestions come from LKCM employees who have **used the app before** (their User row already exists). That's enough for most cases and requires no extra Entra setup.

If you want "type a name, see *anyone* in the LKCM directory" — including people who haven't used the app yet — add this application permission. It requires **Global Administrator** consent, so skip if your CTO doesn't have that role.

1. **API permissions → Add a permission → Microsoft Graph → Application permissions**.
2. Add: `User.Read.All`.
3. Click **Grant admin consent for LKCM**.

Verification: the "Status" column should show a green check with **Granted for LKCM**. If it doesn't show up after consent, refresh the page.

The app merges Graph results with the local list silently if this is granted, and falls through cleanly if it isn't. No code change either way.

## 4. Enforce MFA via Microsoft Authenticator

This is done at the tenant level, not the app level:

- **Entra ID → Security → Conditional Access → New policy**.
- Users: the security group containing everyone who'll use the IC Bot (or "All users" if simpler).
- Cloud apps: scope to the `LKCM IC Bot` app registration (cleaner) or "All cloud apps".
- Grant: **Require multifactor authentication** → Microsoft Authenticator preferred.
- Enable the policy.

## 5. Admin users

Users become admins based on `ADMIN_EMAILS` in the app's `.env` (comma-separated, lowercased). On first sign-in the app upserts the user row with `role = admin` if the email matches. This is separate from Entra's directory roles.

Recommend starting with just the CTO's email.
