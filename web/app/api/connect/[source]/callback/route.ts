import { auth } from "@/auth";
import { getIntegration } from "@/lib/integrations/registry";
import { saveConnection } from "@/lib/integrations/store";
import { appUrl } from "@/lib/integrations/util";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// OAuth callback for any provider: /api/connect/<source>/callback
export async function GET(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", appUrl()));

  const { source } = await params;
  const integration = getIntegration(source);
  if (!integration) return NextResponse.redirect(new URL("/board?error=unknown_source", appUrl()));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(new URL(`/board?error=${encodeURIComponent(oauthError)}`, appUrl()));
  }

  const jar = await cookies();
  const expected = jar.get(`oauth_state_${source}`)?.value;
  jar.delete(`oauth_state_${source}`);
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/board?error=invalid_state", appUrl()));
  }

  try {
    const token = await integration.exchangeCode(code);
    await saveConnection(session.user.id, integration.source, token);
    await integration.sync(session.user.id);
    return NextResponse.redirect(new URL(`/board?connected=${source}`, appUrl()));
  } catch (e) {
    console.error(`${source} connect failed:`, e);
    return NextResponse.redirect(new URL(`/board?error=${source}_connect_failed`, appUrl()));
  }
}
