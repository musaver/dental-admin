import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { adminRoles, adminUsers, loginAttempts } from '@/lib/schema';
import { parsePermissions } from '@/lib/permissions';
import { clinicNow } from '@/lib/datetime';
import bcrypt from 'bcrypt';
import { and, eq, gte, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Staff authentication.
 *
 * DrizzleAdapter is deliberately absent. Under a Credentials provider with the
 * JWT strategy it is never exercised, and it would break if it ever were: it
 * expects a `users` export (this schema exports `user`) and a two-column
 * verification_tokens primary key (this one has three, including `otp`). The
 * patient portal rolls its own OTP against user.otp / user.otp_expiry rather
 * than using the adapter's email flow.
 */

/** Error codes surfaced to /login. Returning null collapses them all into one. */
export const AUTH_ERROR = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
} as const;

/** Sliding-window lockout. No lockedUntil column exists, so the window ages out. */
const LOCKOUT = {
  WINDOW_MINUTES: 15,
  MAX_FAILURES_PER_EMAIL: 5,
  MAX_FAILURES_PER_IP: 20,
} as const;

function clientIp(req: unknown): string | null {
  const headers = (req as { headers?: Record<string, string | string[] | undefined> })?.headers;
  if (!headers) return null;
  const raw = headers['x-forwarded-for'] ?? headers['x-real-ip'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  // x-forwarded-for is a chain; the first hop is the client.
  return value ? String(value).split(',')[0]!.trim().slice(0, 45) : null;
}

async function recordAttempt(email: string, ip: string | null, success: boolean) {
  try {
    await db.insert(loginAttempts).values({
      id: uuidv4(),
      email: email.toLowerCase().slice(0, 255),
      ipAddress: ip,
      success,
      createdAt: clinicNow(),
    });
  } catch (error) {
    // Never let telemetry break a login.
    console.error('Failed to record login attempt:', error);
  }
}

/** True when this email or IP has failed too often inside the window. */
async function isLockedOut(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(clinicNow().getTime() - LOCKOUT.WINDOW_MINUTES * 60_000);

  const [byEmail] = await db
    .select({ n: sql<number>`count(*)` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email.toLowerCase()),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, since)
      )
    );

  if (Number(byEmail?.n ?? 0) >= LOCKOUT.MAX_FAILURES_PER_EMAIL) return true;

  if (ip) {
    const [byIp] = await db
      .select({ n: sql<number>`count(*)` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ipAddress, ip),
          eq(loginAttempts.success, false),
          gte(loginAttempts.createdAt, since)
        )
      );
    if (Number(byIp?.n ?? 0) >= LOCKOUT.MAX_FAILURES_PER_IP) return true;
  }

  return false;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  session: {
    // Eight hours rather than twenty-four: short enough that a stale token
    // dies overnight, with updateAge sliding it forward for anyone actively
    // working. Revocation itself does not rely on this — see requirePermission,
    // which re-reads isActive on every API call.
    strategy: 'jwt',
    maxAge: 8 * 60 * 60,
    updateAge: 60 * 60,
  },

  pages: { signIn: '/login' },

  providers: [
    CredentialsProvider({
      id: 'staff-credentials',
      name: 'Staff',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        const ip = clientIp(req);

        if (!email || !password) {
          throw new Error(AUTH_ERROR.INVALID_CREDENTIALS);
        }

        if (await isLockedOut(email, ip)) {
          await recordAttempt(email, ip, false);
          throw new Error(AUTH_ERROR.ACCOUNT_LOCKED);
        }

        const [row] = await db
          .select({
            id: adminUsers.id,
            email: adminUsers.email,
            name: adminUsers.name,
            password: adminUsers.password,
            roleId: adminUsers.roleId,
            branchId: adminUsers.branchId,
            staffType: adminUsers.staffType,
            isActive: adminUsers.isActive,
            roleName: adminRoles.name,
            permissions: adminRoles.permissions,
          })
          .from(adminUsers)
          .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
          .where(eq(adminUsers.email, email))
          .limit(1);

        if (!row) {
          await recordAttempt(email, ip, false);
          // Same error as a wrong password: never reveal which accounts exist.
          throw new Error(AUTH_ERROR.INVALID_CREDENTIALS);
        }

        const passwordOk = await bcrypt.compare(password, row.password ?? '');
        if (!passwordOk) {
          await recordAttempt(email, ip, false);
          throw new Error(AUTH_ERROR.INVALID_CREDENTIALS);
        }

        // Checked AFTER the password so a disabled account cannot be used to
        // probe which emails are registered.
        if (!row.isActive) {
          await recordAttempt(email, ip, false);
          throw new Error(AUTH_ERROR.ACCOUNT_DISABLED);
        }

        await recordAttempt(email, ip, true);

        return {
          id: row.id,
          email: row.email,
          name: row.name,
          kind: 'staff' as const,
          roleId: row.roleId,
          roleName: row.roleName ?? null,
          branchId: row.branchId,
          staffType: row.staffType,
          permissions: parsePermissions(row.permissions),
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as typeof user & {
          kind?: string;
          roleId?: string;
          roleName?: string | null;
          branchId?: string | null;
          staffType?: string | null;
          permissions?: string[];
        };
        token.id = u.id;
        token.kind = u.kind ?? 'staff';
        token.roleId = u.roleId;
        token.roleName = u.roleName ?? null;
        token.branchId = u.branchId ?? null;
        token.staffType = u.staffType ?? null;
        token.permissions = u.permissions ?? [];
      }

      // Refresh the claims when the client calls session.update(), so a role
      // change takes effect without waiting for the token to expire.
      if (trigger === 'update' && token.id) {
        const [row] = await db
          .select({
            roleId: adminUsers.roleId,
            branchId: adminUsers.branchId,
            staffType: adminUsers.staffType,
            isActive: adminUsers.isActive,
            roleName: adminRoles.name,
            permissions: adminRoles.permissions,
          })
          .from(adminUsers)
          .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
          .where(eq(adminUsers.id, String(token.id)))
          .limit(1);

        if (row) {
          token.roleId = row.roleId;
          token.roleName = row.roleName ?? null;
          token.branchId = row.branchId ?? null;
          token.staffType = row.staffType ?? null;
          token.permissions = row.isActive ? parsePermissions(row.permissions) : [];
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        Object.assign(session.user, {
          id: token.id,
          kind: token.kind ?? 'staff',
          roleId: token.roleId ?? null,
          roleName: token.roleName ?? null,
          branchId: token.branchId ?? null,
          staffType: token.staffType ?? null,
          permissions: token.permissions ?? [],
        });
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // Fall through to the default.
      }
      return `${baseUrl}/`;
    },
  },
};
