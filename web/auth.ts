import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { prisma } from "@/lib/prisma";

/**
 * Auth.js v5 — passwordless login for Tide.
 *  - Google OAuth (one-click)
 *  - Email magic link via Resend
 * Sessions are stored in Postgres (database strategy), so logout
 * actually destroys the session server-side.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM ?? "Tide <onboarding@resend.dev>",
    }),
  ],
  callbacks: {
    // Expose the user id on the session for server components / API routes.
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
