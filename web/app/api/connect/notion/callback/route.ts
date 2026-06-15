import { auth } from "@/auth";
import { exchangeNotionCode, saveNotionConnection, syncNotion } from "@/lib/notion";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const base = () => process.env.NEXTAUTH_URL ?? "http://localhost:3000";

// Notion redirects here with ?code & ?state. Verify, exchange, store
// (encrypted), and kick off an initial sync.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", base()));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.redirect(new URL(`/board?error=${encodeURIComponent(error)}`, base()));

  const jar = await cookies();
  const expected = jar.get("notion_oauth_state")?.value;
  jar.delete("notion_oauth_state");

  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/board?error=invalid_state", base()));
  }

  try {
    const token = await exchangeNotionCode(code);
    await saveNotionConnection(session.user.id, token);
    await syncNotion(session.user.id);
    return NextResponse.redirect(new URL("/board?connected=notion", base()));
  } catch (e) {
    console.error("Notion connect failed:", e);
    return NextResponse.redirect(new URL("/board?error=notion_connect_failed", base()));
  }
}
