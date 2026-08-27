import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const { pathname } = request.nextUrl;

  // --- API routes: respond with JSON 401 instead of redirecting ---
  if (pathname.startsWith("/api")) {
    // NextAuth endpoints must stay public so login itself works
    if (pathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // --- Pages ---
  const isAuthPage = pathname.startsWith("/login");

  if (token && isAuthPage) {
    // Logged-in user hitting /login → send to dashboard
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!token && !isAuthPage) {
    // Any admin page requires a session
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  // This covers all admin pages AND all /api routes (auth is allow-listed above).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|txt|woff|woff2|ttf)$).*)",
  ],
};
