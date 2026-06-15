import { auth } from "@/auth";
import { notionAuthorizeUrl } from "@/lib/notion";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Start the Notion OAuth flow. Requires a logged-in Tide user.
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", process.env.NEXTAUTH_URL ?? "http://localhost:3000"));

  // CSRF: random state echoed back on the callback, stored httpOnly.
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("notion_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(notionAuthorizeUrl(state));
}
