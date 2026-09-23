import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { BackendUser } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Real Google OAuth (Authorization Code flow) handled entirely by NextAuth.
// Once Google hands back an ID token we immediately exchange it, server to
// server, for our own backend session JWT -- the backend independently
// verifies the Google ID token against Google's public keys before issuing
// that JWT (see backend/src/services/googleAuth.ts). Nothing here is
// mocked: a bad/forged token is rejected by the backend and login fails.
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.id_token) {
        try {
          const res = await fetch(`${API_URL}/api/auth/google`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: account.id_token }),
          });
          if (res.ok) {
            const data = (await res.json()) as { token: string; user: BackendUser };
            token.backendToken = data.token;
            token.backendUser = data.user;
          } else {
            console.error("[next-auth] backend google verification failed", await res.text());
          }
        } catch (err) {
          console.error("[next-auth] failed to reach backend for google verification", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.backendToken = token.backendToken;
      session.backendUser = token.backendUser;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};
