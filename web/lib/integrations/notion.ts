import type { Integration, OAuthToken } from "./types";
import { redirectUri } from "./util";
import { getAccessToken, upsertItem, markSynced, priorityFromDue } from "./store";

const NOTION_VERSION = "2022-06-28";

export const notion: Integration = {
  source: "notion",
  label: "Notion",

  authorizeUrl(state) {
    const u = new URL("https://api.notion.com/v1/oauth/authorize");
    u.searchParams.set("client_id", process.env.NOTION_CLIENT_ID!);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("owner", "user");
    u.searchParams.set("redirect_uri", redirectUri("notion"));
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode(code): Promise<OAuthToken> {
    const basic = Buffer.from(
      `${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`
    ).toString("base64");
    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri("notion"),
      }),
    });
    if (!res.ok) throw new Error(`Notion token: ${res.status} ${await res.text()}`);
    const d = await res.json();
    return {
      accessToken: d.access_token,
      externalAccountId: d.workspace_id,
      workspaceName: d.workspace_name ?? null,
    };
    // Notion access tokens do not expire — no refresh needed.
  },

  async sync(userId) {
    const got = await getAccessToken(userId, "notion");
    if (!got) return 0;
    const { access, conn } = got;

    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 25,
      }),
    });
    if (!res.ok) throw new Error(`Notion search: ${res.status} ${await res.text()}`);
    const pages = (await res.json()).results ?? [];

    let count = 0;
    for (const page of pages) {
      const title = extractTitle(page.properties) || "Untitled";
      const dueAt = extractDue(page.properties);
      await upsertItem(userId, conn.id, "notion", page.id, {
        title,
        url: page.url,
        priority: priorityFromDue(dueAt),
        chip: dueAt ? "due" : null,
        dueAt,
        updatedAtSource: page.last_edited_time ? new Date(page.last_edited_time) : null,
        raw: page,
      });
      count++;
    }
    await markSynced(conn.id);
    return count;
  },
};

function extractTitle(props: Record<string, any>): string | null {
  for (const k of Object.keys(props ?? {})) {
    const p = props[k];
    if (p?.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t: any) => t.plain_text).join("") || null;
    }
  }
  return null;
}

function extractDue(props: Record<string, any>): Date | null {
  for (const k of Object.keys(props ?? {})) {
    const p = props[k];
    if (p?.type === "date" && p.date?.start) return new Date(p.date.start);
  }
  return null;
}
