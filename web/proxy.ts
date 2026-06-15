import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Next.js 16: this file is `proxy.ts` (formerly middleware.ts) and runs
// on the Node.js runtime by default — so importing Prisma via auth() is fine.
// Gate the app: unauthenticated users hitting protected routes go to /login.
export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/";

  if (!isLoggedIn && !isPublic) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
