import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

/**
 * Edge-runtime-safe subset of the NextAuth config. Used by middleware and by
 * the full auth.ts that adds Prisma-backed callbacks for Node runtimes.
 *
 * Must not import anything that uses Node APIs (Prisma, fs, etc.), or the
 * middleware bundle will fail to build.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/v2.0`
    })
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      // Webhook-style endpoints called by third parties (Vercel Blob,
      // Pipedrive). Each validates its own request auth — we must skip the
      // NextAuth redirect so POST bodies don't get lost.
      const publicPaths = [
        "/login",
        "/api/auth",
        "/api/upload/handle",
        "/api/webhooks"
      ];
      const isPublic = publicPaths.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`)
      );
      if (!isLoggedIn && !isPublic) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("from", pathname);
        return Response.redirect(loginUrl);
      }
      return true;
    }
  }
} satisfies NextAuthConfig;
