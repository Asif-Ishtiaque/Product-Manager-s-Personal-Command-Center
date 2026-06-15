import { auth } from "@/auth";
import { getIntegration } from "@/lib/integrations/registry";
import { appUrl } from "@/lib/integrations/util";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Start any provider's OAuth flow: /api/connect/<source>
export async function GET(_req: Request, { params }: { params: Promise<{ source: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", appUrl()));

  const { source } = await params;
  const integration = getIntegration(source);
  if (!integration) return NextResponse.redirect(new URL("/board?error=unknown_source", appUrl()));

  // CSRF: random state echoed on the callback, scoped to this source.
  const state = randomBytes(16).toString("hex");
  (await cookies()).set(`oauth_state_${source}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(integration.authorizeUrl(state));
}
