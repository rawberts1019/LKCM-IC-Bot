import NextAuth, { type DefaultSession } from "next-auth";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";
import { adminEmails } from "@/env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "member";
    } & DefaultSession["user"];
  }
}

type ExtendedToken = {
  userId?: string;
  role?: "admin" | "member";
} & Record<string, unknown>;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, profile }) {
      if (!user.email) return false;
      const isAdmin = adminEmails.includes(user.email.toLowerCase());
      const entraOid = (profile as { oid?: string } | undefined)?.oid;
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name ?? undefined,
          entraOid: entraOid ?? undefined,
          ...(isAdmin ? { role: "admin" as const } : {})
        },
        create: {
          email: user.email,
          name: user.name ?? undefined,
          entraOid: entraOid ?? undefined,
          role: isAdmin ? "admin" : "member"
        }
      });
      return true;
    },
    async jwt({ token, user }) {
      const t = token as ExtendedToken;
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, role: true }
        });
        if (dbUser) {
          t.userId = dbUser.id;
          t.role = dbUser.role;
        }
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as ExtendedToken;
      if (t.userId) session.user.id = t.userId;
      if (t.role) session.user.role = t.role;
      return session;
    }
  }
});
