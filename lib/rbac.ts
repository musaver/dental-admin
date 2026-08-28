import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { adminRoles, adminUsers } from '@/lib/schema';
import { hasPermission, parsePermissions, type Permission } from '@/lib/permissions';
import {
  AuthError,
  AUTH_FAILURE,
  canAccessBranch,
  resolveBranchScope,
  type BranchScope,
} from '@/lib/branch-scope';
import { eq } from 'drizzle-orm';

// Branch rules live in lib/branch-scope.ts so they stay free of next-auth and
// remain unit-testable; re-exported here so routes have one import.
export { AuthError, AUTH_FAILURE, canAccessBranch, resolveBranchScope };
export type { BranchScope, AuthFailure } from '@/lib/branch-scope';

/**
 * Server-side authorisation for API routes.
 *
 * This — not the JWT — is the authorisation boundary. The session's permission
 * list is a snapshot from sign-in; this re-reads `admin_users` and
 * `admin_roles` on every call, which is what makes deactivating a staff member
 * take effect on their NEXT REQUEST rather than whenever their 8-hour token
 * happens to expire.
 *
 * Deliberately NOT done in middleware.ts: middleware runs on the Edge runtime,
 * where mysql2 cannot load. A database check there would force the entire
 * application onto the Node runtime, or simply fail to build.
 *
 * A short cache keeps the cost to roughly one query per user per few seconds
 * while keeping revocation effectively immediate.
 */

export interface StaffContext {
  userId: string;
  email: string;
  name: string | null;
  roleId: string | null;
  roleName: string | null;
  staffType: string | null;
  permissions: Permission[];
  /**
   * The branch this user belongs to, or null for head office.
   * Null means cross-branch visibility — see resolveBranchScope().
   */
  branchId: string | null;
  isHeadOffice: boolean;
  /** Convenience wrapper over this user's live permission list. */
  can: (permission: Permission) => boolean;
}

/** Cache window. Long enough to spare the database, short enough that
 *  revoking access feels immediate to whoever just clicked "deactivate". */
const CACHE_TTL_MS = 5_000;

interface CachedStaff {
  at: number;
  row: {
    id: string;
    email: string;
    name: string | null;
    roleId: string | null;
    roleName: string | null;
    staffType: string | null;
    branchId: string | null;
    isActive: boolean;
    permissions: Permission[];
  } | null;
}

const cache = new Map<string, CachedStaff>();

/** Drop a user's cached row so the next request re-reads it immediately. */
export function invalidateStaffCache(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

async function loadStaff(userId: string): Promise<CachedStaff['row']> {
  const cached = cache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.row;

  const [found] = await db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      name: adminUsers.name,
      roleId: adminUsers.roleId,
      branchId: adminUsers.branchId,
      staffType: adminUsers.staffType,
      isActive: adminUsers.isActive,
      roleName: adminRoles.name,
      permissions: adminRoles.permissions,
    })
    .from(adminUsers)
    .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
    .where(eq(adminUsers.id, userId))
    .limit(1);

  const row = found
    ? {
        id: found.id,
        email: found.email,
        name: found.name,
        roleId: found.roleId,
        roleName: found.roleName ?? null,
        staffType: found.staffType,
        branchId: found.branchId,
        isActive: Boolean(found.isActive),
        permissions: parsePermissions(found.permissions),
      }
    : null;

  cache.set(userId, { at: Date.now(), row });
  return row;
}

/**
 * Resolve the caller, verifying they are still an active staff member.
 * Throws AuthError; call inside withAuth() or catch it yourself.
 */
export async function requireStaff(): Promise<StaffContext> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;

  if (!sessionUser?.id) {
    throw new AuthError(AUTH_FAILURE.UNAUTHENTICATED, 401, 'Sign in to continue.');
  }

  if (sessionUser.kind && sessionUser.kind !== 'staff') {
    throw new AuthError(
      AUTH_FAILURE.WRONG_AUDIENCE,
      403,
      'This area is for clinic staff.'
    );
  }

  const row = await loadStaff(sessionUser.id);

  // The account was deleted, or the token predates it.
  if (!row) {
    throw new AuthError(AUTH_FAILURE.ACCOUNT_DISABLED, 403, 'Your account no longer exists.');
  }

  if (!row.isActive) {
    throw new AuthError(
      AUTH_FAILURE.ACCOUNT_DISABLED,
      403,
      'Your account has been deactivated.'
    );
  }

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    roleId: row.roleId,
    roleName: row.roleName,
    staffType: row.staffType,
    permissions: row.permissions,
    branchId: row.branchId,
    isHeadOffice: row.branchId === null,
    can: (permission: Permission) => hasPermission(row.permissions, permission),
  };
}

/** requireStaff plus a permission check. */
export async function requirePermission(permission: Permission): Promise<StaffContext> {
  const ctx = await requireStaff();
  if (!ctx.can(permission)) {
    throw new AuthError(
      AUTH_FAILURE.FORBIDDEN,
      403,
      'You do not have permission to do that.'
    );
  }
  return ctx;
}

/** Require every listed permission. */
export async function requireAllPermissions(
  permissions: readonly Permission[]
): Promise<StaffContext> {
  const ctx = await requireStaff();
  const missing = permissions.filter((p) => !ctx.can(p));
  if (missing.length) {
    throw new AuthError(
      AUTH_FAILURE.FORBIDDEN,
      403,
      'You do not have permission to do that.'
    );
  }
  return ctx;
}

/** Convert an AuthError (or anything else) into the house error response. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error('Unhandled route error:', error);
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}

/**
 * Wrap a route handler so authorisation and error shaping are impossible to
 * forget:
 *
 *   export const GET = withAuth(PERMISSIONS.PATIENTS_VIEW, async (req, ctx) => {
 *     ...
 *   });
 *
 * Pass null as the permission for routes that need a signed-in staff member
 * but no specific right.
 */
export function withAuth<TArgs extends unknown[]>(
  permission: Permission | null,
  handler: (
    req: Request,
    ctx: StaffContext,
    ...args: TArgs
  ) => Promise<NextResponse> | NextResponse
) {
  return async (req: Request, ...args: TArgs): Promise<NextResponse> => {
    try {
      const ctx = permission ? await requirePermission(permission) : await requireStaff();
      return await handler(req, ctx, ...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
