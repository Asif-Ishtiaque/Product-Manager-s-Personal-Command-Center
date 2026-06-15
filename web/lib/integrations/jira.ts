import type { Integration, OAuthToken } from "./types";
import { redirectUri, expiresAtFromNow } from "./util";
import { getAccessToken, upsertItem, markSynced } from "./store";

// Atlassian OAuth 2.0 (3LO). Access tokens expire (~1h) and are refreshed
// via offline_access. API calls are scoped to a cloudId obtained from
// /oauth/token/accessible-resources after consent.
const SCOPES = ["read:jira-work", "read:me", "offline_access"].join(" ");

export const jira: Integration = {
  source: "jira",
  label: "Jira",

  authorizeUrl(state) {
    const u = new URL("https://auth.atlassian.com/authorize");
    u.searchParams.set("audience", "api.atlassian.com");
    u.searchParams.set("client_id", process.env.JIRA_CLIENT_ID!);
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("redirect_uri", redirectUri("jira"));
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("prompt", "consent");
    return u.toString();
  },

  async exchangeCode(code): Promise<OAuthToken> {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri("jira"),
      }),
    });
    if (!res.ok) throw new Error(`Jira token: ${res.status} ${await res.text()}`);
    const d = await res.json();

    // Resolve the cloudId + site url we'll call the API against.
    const resources = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { Authorization: `Bearer ${d.access_token}`, Accept: "application/json" },
    }).then((r) => r.json());
    const site = Array.isArray(resources) ? resources[0] : null;

    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? null,
      expiresAt: expiresAtFromNow(d.expires_in),
      externalAccountId: site?.id ?? null, // cloudId
      workspaceName: site?.url ?? null, // e.g. https://you.atlassian.net
      scope: d.scope ?? null,
    };
  },

  async refresh(refreshToken): Promise<OAuthToken> {
    const res = await fetch("https://auth.atlassian.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Jira refresh: ${res.status} ${await res.text()}`);
    const d = await res.json();
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token ?? refreshToken,
      expiresAt: expiresAtFromNow(d.expires_in),
    };
  },

  async sync(userId) {
    const got = await getAccessToken(userId, "jira", this.refresh);
    if (!got) return 0;
    const { access, conn } = got;
    const cloudId = conn.externalAccountId;
    if (!cloudId) return 0;

    const jql =
      "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
    const res = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          maxResults: 25,
          fields: ["summary", "status", "priority", "duedate", "updated", "issuetype"],
        }),
      }
    );
    if (!res.ok) throw new Error(`Jira search: ${res.status} ${await res.text()}`);
    const issues = (await res.json()).issues ?? [];

    let count = 0;
    for (const it of issues) {
      const f = it.fields ?? {};
      const due = f.duedate ? new Date(f.duedate) : null;
      const blocked = /block|impede|hold/i.test(f.status?.name ?? "");
      const highPri = /highest|high|urgent/i.test(f.priority?.name ?? "");
      const priority = blocked || (due && due < new Date()) ? "p0" : highPri ? "p1" : "p2";
      await upsertItem(userId, conn.id, "jira", it.key, {
        title: f.summary ?? it.key,
        status: `${f.issuetype?.name ?? "Issue"} · ${f.status?.name ?? ""}`,
        url: conn.workspaceName ? `${conn.workspaceName}/browse/${it.key}` : null,
        priority,
        chip: blocked ? "blocked" : due ? "due" : null,
        dueAt: due,
        updatedAtSource: f.updated ? new Date(f.updated) : null,
        raw: it,
      });
      count++;
    }
    await markSynced(conn.id);
    return count;
  },
};
