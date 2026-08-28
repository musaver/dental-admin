import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Coarse routing gate.
 *
 * This runs on the EDGE runtime, where mysql2 cannot load — so it can only
 * verify the token signature and read its claims. It deliberately does no
 * database work and makes no permission decisions.
 *
 * The real authorisation boundary is requirePermission() in lib/rbac.ts, which
 * re-reads admin_users.isActive and the role's permissions on every API call.
 * Do not "fix" staff deactivation by querying the database here: it will
 * either fail to build or force the whole application off the Edge runtime.
 */

/** Public API routes. Anything not listed requires a session. */
const PUBLIC_API_PREFIXES = [
  // NextAuth's own endpoints, or sign-in cannot work.
  '/api/auth',
  // Scheduled jobs authenticate with CRON_SECRET, not a session cookie.
  '/api/cron',
  // Inbound lead capture from a website form or ad platform; carries its own
  // shared-secret header.
  '/api/public',
  // The portal's OTP request happens before any session exists.
  '/api/portal/otp',
];

/** Portal pages reachable without a patient session. */
const PUBLIC_PORTAL_PATHS = ['/portal/login', '/portal/activate'];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const kind = (token?.kind as string | undefined) ?? (token ? 'staff' : undefined);

  const isPortalPage = pathname.startsWith('/portal');
  const isPortalApi = pathname.startsWith('/api/portal');
  const isApi = pathname.startsWith('/api');

  /* ── Public routes ────────────────────────────────────────────────── */

  if (isApi && isPublicApi(pathname)) {
    return NextResponse.next();
  }

  if (isPortalPage && PUBLIC_PORTAL_PATHS.some((p) => pathname.startsWith(p))) {
    // Already signed in as a patient? Skip the login page.
    if (token && kind === 'patient' && pathname.startsWith('/portal/login')) {
      return NextResponse.redirect(new URL('/portal', request.url));
    }
    return NextResponse.next();
  }

  /* ── Patient portal ───────────────────────────────────────────────── */

  if (isPortalApi || isPortalPage) {
    if (!token) {
      return isPortalApi
        ? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        : NextResponse.redirect(new URL('/portal/login', request.url));
    }
    if (kind !== 'patient') {
      // A staff session must not reach patient endpoints: the portal's
      // row-level checks assume the token identifies a portal user.
      return isPortalApi
        ? NextResponse.json(
            { error: 'This area is for patients.', code: 'WRONG_AUDIENCE' },
            { status: 403 }
          )
        : NextResponse.redirect(new URL('/', request.url));
    }
    return NextResponse.next();
  }

  /* ── Staff application ────────────────────────────────────────────── */

  if (isApi) {
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (kind !== 'staff') {
      return NextResponse.json(
        { error: 'This area is for clinic staff.', code: 'WRONG_AUDIENCE' },
        { status: 403 }
      );
    }
    return NextResponse.next();
  }

  const isLoginPage = pathname.startsWith('/login');

  if (token && kind === 'staff' && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if ((!token || kind !== 'staff') && !isLoginPage) {
    const target = new URL('/login', request.url);
    // Come back to where they were headed once they have signed in.
    if (pathname !== '/') target.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map|txt|woff|woff2|ttf)$).*)',
  ],
};
