import type { Integration, OAuthToken } from "./types";
import { redirectUri, expiresAtFromNow } from "./util";
import { getAccessToken, markSynced } from "./store";

// Figma OAuth 2.0. Access tokens expire and refresh via refresh_token.
//
// NOTE: Figma's API has no "files awaiting my review" endpoint — attention
// items require knowing specific file keys (then GET /v1/files/:key/comments).
// OAuth + token storage are fully wired here; populating items needs a
// file-picker step (next iteration). sync() validates the token and no-ops.
export const figma: Integration = {
  source: "figma",
  label: "Figma",

  authorizeUrl(state) {
    const u = new URL("https://www.figma.com/oauth");
    u.searchParams.set("client_id", process.env.FIGMA_CLIENT_ID!);
    u.searchParams.set("redirect_uri", redirectUri("figma"));
    u.searchParams.set("scope", "files:read");
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    return u.toString();
  },

  async exchangeCode(code): Promise<OAuthToken> {
    const body = new URLSearchParams({
      client_id: process.env.FIGMA_CLIENT_ID!,
      client_secret: process.env.FIGMA_CLIENT_SECRET!,
      redirect_uri: redirectUri("figma"),
      code,
      grant_type: "authorization_code",
    });
    const res = await fetch("https://api.figma.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Figma token: ${res.status} ${await res.text()}`);
    const d = await res.json();
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? null,
      expiresAt: expiresAtFromNow(d.expires_in),
      externalAccountId: d.user_id ? String(d.user_id) : null,
    };
  },

  async refresh(refreshToken): Promise<OAuthToken> {
    const body = new URLSearchParams({
      client_id: process.env.FIGMA_CLIENT_ID!,
      client_secret: process.env.FIGMA_CLIENT_SECRET!,
      refresh_token: refreshToken,
    });
    const res = await fetch("https://api.figma.com/v1/oauth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Figma refresh: ${res.status} ${await res.text()}`);
    const d = await res.json();
    return { accessToken: d.access_token, refreshToken, expiresAt: expiresAtFromNow(d.expires_in) };
  },

  async sync(userId) {
    const got = await getAccessToken(userId, "figma", this.refresh);
    if (!got) return 0;
    const { access, conn } = got;
    // Validate the token; item population awaits the file-picker step.
    const me = await fetch("https://api.figma.com/v1/me", {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!me.ok) throw new Error(`Figma me: ${me.status} ${await me.text()}`);
    await markSynced(conn.id);
    return 0;
  },
};
