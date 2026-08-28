/**
 * Branch visibility rules.
 *
 * Kept free of any next-auth or database import so it stays pure, unit
 * testable, and usable from scripts. lib/rbac.ts re-exports these.
 *
 * CONVENTION: `admin_users.branchId IS NULL` means head office and sees every
 * branch; any other value confines the user to that branch alone. The seeded
 * owner is already NULL, so this needs no data change.
 */

export const AUTH_FAILURE = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  FORBIDDEN: 'FORBIDDEN',
  WRONG_AUDIENCE: 'WRONG_AUDIENCE',
} as const;

export type AuthFailure = (typeof AUTH_FAILURE)[keyof typeof AUTH_FAILURE];

/**
 * Fields are declared and assigned explicitly rather than using TypeScript
 * parameter properties. Node's built-in TypeScript support is strip-only: it
 * removes type annotations but performs no transformation, so
 * `constructor(readonly code: X)` fails to load under `node --test`.
 * The same applies to TS enums and namespaces — hence the `as const` objects
 * used for vocabularies throughout lib/.
 */
export class AuthError extends Error {
  readonly code: AuthFailure;
  readonly status: number;

  constructor(code: AuthFailure, status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

/** The parts of a staff context that branch scoping actually needs. */
export interface BranchScopable {
  branchId: string | null;
  isHeadOffice: boolean;
}

export interface BranchScope {
  /** null means "every branch" — only ever produced for head office. */
  branchIds: string[] | null;
  activeBranchId: string | null;
}

/**
 * Resolve which branches a request may touch.
 *
 * `requested` is untrusted input from the query string. A scoped user asking
 * for someone else's branch gets a 403 rather than an empty list: silently
 * returning nothing would hide the attempt and look like a bug.
 */
export function resolveBranchScope(
  ctx: BranchScopable,
  requested?: string | null
): BranchScope {
  if (ctx.isHeadOffice) {
    if (!requested || requested === 'all') {
      return { branchIds: null, activeBranchId: null };
    }
    return { branchIds: [requested], activeBranchId: requested };
  }

  const own = ctx.branchId;
  if (own === null) {
    // isHeadOffice false with a null branchId is a contradiction; refuse
    // rather than guessing which half is right.
    throw new AuthError(
      AUTH_FAILURE.FORBIDDEN,
      403,
      'Your account is not assigned to a branch.'
    );
  }

  if (requested && requested !== 'all' && requested !== own) {
    throw new AuthError(AUTH_FAILURE.FORBIDDEN, 403, 'You do not have access to that branch.');
  }

  return { branchIds: [own], activeBranchId: own };
}

/** True when the caller may act on a row belonging to `branchId`. */
export function canAccessBranch(ctx: BranchScopable, branchId: string | null): boolean {
  if (ctx.isHeadOffice) return true;
  return branchId !== null && branchId === ctx.branchId;
}
