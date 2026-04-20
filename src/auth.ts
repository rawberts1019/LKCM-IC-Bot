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

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: "admin" | "member";
  }
}

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
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, role: true }
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId;
      if (token.role) session.user.role = token.role;
      return session;
    }
  }
});
