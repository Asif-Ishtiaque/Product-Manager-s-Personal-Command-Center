import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";

const NOTION_VERSION = "2022-06-28";

export function notionAuthorizeUrl(state: string): string {
  const u = new URL("https://api.notion.com/v1/oauth/authorize");
  u.searchParams.set("client_id", process.env.NOTION_CLIENT_ID!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("owner", "user");
  u.searchParams.set("redirect_uri", process.env.NOTION_REDIRECT_URI!);
  u.searchParams.set("state", state);
  return u.toString();
}

type NotionToken = {
  access_token: string;
  workspace_id: string;
  workspace_name?: string;
  bot_id?: string;
};

// Exchange the OAuth code for a token (Basic-auth with client id:secret).
export async function exchangeNotionCode(code: string): Promise<NotionToken> {
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
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`Notion token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Persist the connection with the token encrypted at rest.
export async function saveNotionConnection(userId: string, token: NotionToken) {
  return prisma.connection.upsert({
    where: { userId_source: { userId, source: "notion" } },
    create: {
      userId,
      source: "notion",
      externalAccountId: token.workspace_id,
      workspaceName: token.workspace_name ?? null,
      accessTokenEnc: encrypt(token.access_token),
    },
    update: {
      externalAccountId: token.workspace_id,
      workspaceName: token.workspace_name ?? null,
      accessTokenEnc: encrypt(token.access_token),
    },
  });
}

type NotionPage = {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, any>;
};

// Pull pages the integration can see, newest first, and normalize them
// into Tide Items. Title + a Due date (if any) drive the attention model.
export async function syncNotion(userId: string): Promise<number> {
  const conn = await prisma.connection.findUnique({
    where: { userId_source: { userId, source: "notion" } },
  });
  if (!conn) return 0;
  const token = decrypt(conn.accessTokenEnc);

  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 25,
    }),
  });
  if (!res.ok) throw new Error(`Notion search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const pages: NotionPage[] = data.results ?? [];

  let count = 0;
  for (const page of pages) {
    const title = extractTitle(page.properties) || "Untitled";
    const dueAt = extractDue(page.properties);
    const priority = computePriority(dueAt);

    await prisma.item.upsert({
      where: { userId_source_externalId: { userId, source: "notion", externalId: page.id } },
      create: {
        userId,
        connectionId: conn.id,
        source: "notion",
        externalId: page.id,
        title,
        url: page.url,
        priority,
        chip: dueAt ? "due" : null,
        dueAt,
        updatedAtSource: new Date(page.last_edited_time),
        raw: page as any,
      },
      update: {
        title,
        url: page.url,
        priority,
        chip: dueAt ? "due" : null,
        dueAt,
        updatedAtSource: new Date(page.last_edited_time),
        raw: page as any,
      },
    });
    count++;
  }

  await prisma.connection.update({
    where: { id: conn.id },
    data: { lastSyncedAt: new Date() },
  });
  return count;
}

function extractTitle(props: Record<string, any>): string | null {
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === "title" && Array.isArray(p.title)) {
      return p.title.map((t: any) => t.plain_text).join("") || null;
    }
  }
  return null;
}

function extractDue(props: Record<string, any>): Date | null {
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p?.type === "date" && p.date?.start) return new Date(p.date.start);
  }
  return null;
}

function computePriority(dueAt: Date | null): string {
  if (!dueAt) return "p2";
  const ms = dueAt.getTime() - Date.now();
  if (ms < 0) return "p0"; // overdue
  if (ms < 24 * 3600 * 1000) return "p1"; // due within a day
  return "p2";
}
