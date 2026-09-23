import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

const client = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

export interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Verifies a Google ID token returned by the frontend's real Google
 * OAuth (NextAuth "google" provider) sign-in flow. This is server-side
 * cryptographic verification against Google's public keys -- not a mock.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!client || !env.googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the backend");
  }
  const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    throw new Error("Invalid Google ID token payload");
  }
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    avatarUrl: payload.picture,
  };
}

export async function upsertGoogleUser(profile: GoogleProfile) {
  return prisma.user.upsert({
    where: { email: profile.email },
    update: {
      googleId: profile.googleId,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
    create: {
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
    },
  });
}
