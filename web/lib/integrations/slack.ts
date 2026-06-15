import type { Integration, OAuthToken } from "./types";
import { redirectUri } from "./util";
import { getAccessToken, upsertItem, markSynced } from "./store";

// Slack OAuth v2. We request a USER token with search:read so we can pull
// messages that mention the user. User tokens don't expire (unless token
// rotation is enabled on the app).
export const slack: Integration = {
  source: "slack",
  label: "Slack",

  authorizeUrl(state) {
    const u = new URL("https://slack.com/oauth/v2/authorize");
    u.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
    u.searchParams.set("user_scope", "search:read");
    u.searchParams.set("redirect_uri", redirectUri("slack"));
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode(code): Promise<OAuthToken> {
    const body = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri("slack"),
    });
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const d = await res.json();
    if (!d.ok) throw new Error(`Slack token: ${d.error ?? "unknown"}`);
    return {
      accessToken: d.authed_user?.access_token, // user token (search:read)
      externalAccountId: d.team?.id ?? null,
      workspaceName: d.team?.name ?? null,
      scope: d.authed_user?.scope ?? null,
    };
  },

  async sync(userId) {
    const got = await getAccessToken(userId, "slack");
    if (!got) return 0;
    const { access, conn } = got;
    const H = { Authorization: `Bearer ${access}`, Accept: "application/json" };

    const auth = await fetch("https://slack.com/api/auth.test", { headers: H }).then((r) => r.json());
    if (!auth.ok) throw new Error(`Slack auth.test: ${auth.error ?? "unknown"}`);

    const query = encodeURIComponent(`@${auth.user}`);
    const res = await fetch(
      `https://slack.com/api/search.messages?query=${query}&count=20&sort=timestamp`,
      { headers: H }
    );
    const d = await res.json();
    if (!d.ok) throw new Error(`Slack search: ${d.error ?? "unknown"}`);
    const matches = d.messages?.matches ?? [];

    let count = 0;
    for (const m of matches) {
      const ts = m.ts ? new Date(Number(m.ts) * 1000) : null;
      await upsertItem(userId, conn.id, "slack", m.iid ?? m.ts, {
        title: (m.text ?? "").slice(0, 140) || "Mention",
        status: m.channel?.name ? `#${m.channel.name} · ${m.username ?? "someone"}` : (m.username ?? null),
        url: m.permalink ?? null,
        priority: "p1",
        chip: "reply",
        updatedAtSource: ts,
        raw: m,
      });
      count++;
    }
    await markSynced(conn.id);
    return count;
  },
};
