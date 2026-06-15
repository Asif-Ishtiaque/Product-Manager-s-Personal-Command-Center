import { auth } from "@/auth";
import { syncNotion } from "@/lib/notion";
import { NextResponse } from "next/server";

// Re-pull all of the user's connected sources. Today: Notion.
// As we add Jira/Figma/ClickUp/Slack, fan out here.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results: Record<string, number | string> = {};
  try {
    results.notion = await syncNotion(session.user.id);
  } catch (e) {
    results.notion = `error: ${String(e)}`;
  }
  return NextResponse.json({ ok: true, synced: results });
}
