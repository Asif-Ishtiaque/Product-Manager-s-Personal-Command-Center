import type { Source } from "./types";

// Base URL of the app — drives every OAuth redirect URI so we don't need
// a separate REDIRECT_URI env var per provider.
export function appUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

// Each provider's callback lands at /api/connect/<source>/callback.
export function redirectUri(source: Source): string {
  return `${appUrl()}/api/connect/${source}/callback`;
}

export function expiresAtFromNow(seconds?: number): Date | null {
  if (!seconds) return null;
  return new Date(Date.now() + seconds * 1000);
}
