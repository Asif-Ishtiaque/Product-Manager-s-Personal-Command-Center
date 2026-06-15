import type { Integration, OAuthToken } from "./types";
import { redirectUri } from "./util";
import { getAccessToken, upsertItem, markSynced, priorityFromDue } from "./store";

// ClickUp OAuth 2.0. Tokens are long-lived (no refresh). We sync open tasks
// assigned to the user in their first workspace, ordered by due date.
export const clickup: Integration = {
  source: "clickup",
  label: "ClickUp",

  authorizeUrl(state) {
    const u = new URL("https://app.clickup.com/api");
    u.searchParams.set("client_id", process.env.CLICKUP_CLIENT_ID!);
    u.searchParams.set("redirect_uri", redirectUri("clickup"));
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode(code): Promise<OAuthToken> {
    const u = new URL("https://api.clickup.com/api/v2/oauth/token");
    u.searchParams.set("client_id", process.env.CLICKUP_CLIENT_ID!);
    u.searchParams.set("client_secret", process.env.CLICKUP_CLIENT_SECRET!);
    u.searchParams.set("code", code);
    const res = await fetch(u, { method: "POST" });
    if (!res.ok) throw new Error(`ClickUp token: ${res.status} ${await res.text()}`);
    const d = await res.json();
    return { accessToken: d.access_token };
  },

  async sync(userId) {
    const got = await getAccessToken(userId, "clickup");
    if (!got) return 0;
    const { access, conn } = got;
    const H = { Authorization: access, Accept: "application/json" };

    const me = await fetch("https://api.clickup.com/api/v2/user", { headers: H }).then((r) => r.json());
    const myId = me?.user?.id;
    const teams = await fetch("https://api.clickup.com/api/v2/team", { headers: H }).then((r) => r.json());
    const teamId = teams?.teams?.[0]?.id;
    if (!teamId) return 0;

    const params = new URLSearchParams({ order_by: "due_date", include_closed: "false", subtasks: "true" });
    if (myId) params.append("assignees[]", String(myId));
    const res = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/task?${params}`, { headers: H });
    if (!res.ok) throw new Error(`ClickUp tasks: ${res.status} ${await res.text()}`);
    const tasks = (await res.json()).tasks ?? [];

    let count = 0;
    for (const t of tasks) {
      const due = t.due_date ? new Date(Number(t.due_date)) : null;
      const urgent = (t.priority?.priority ?? "").toLowerCase() === "urgent";
      await upsertItem(userId, conn.id, "clickup", t.id, {
        title: t.name ?? "Task",
        status: `${t.list?.name ? t.list.name + " · " : ""}${t.status?.status ?? "open"}`,
        url: t.url ?? null,
        priority: priorityFromDue(due, urgent),
        chip: due && due < new Date() ? "overdue" : due ? "due" : null,
        dueAt: due,
        updatedAtSource: t.date_updated ? new Date(Number(t.date_updated)) : null,
        raw: t,
      });
      count++;
    }
    await markSynced(conn.id);
    return count;
  },
};
