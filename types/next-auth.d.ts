import 'next-auth';
import 'next-auth/jwt';

/**
 * Claims carried on the staff session.
 *
 * `permissions` is a snapshot taken at sign-in. It is fine for deciding what
 * to render, but it is NOT the authorisation boundary — a token issued before
 * a role change keeps the old list until it refreshes. Server-side checks go
 * through requirePermission() in lib/rbac.ts, which re-reads the database.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      kind: 'staff' | 'patient';
      roleId: string | null;
      roleName: string | null;
      /** null means head office: visible across every branch. */
      branchId: string | null;
      staffType: string | null;
      permissions: string[];
    };
  }

  interface User {
    id: string;
    kind?: 'staff' | 'patient';
    roleId?: string | null;
    roleName?: string | null;
    branchId?: string | null;
    staffType?: string | null;
    permissions?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    kind?: 'staff' | 'patient';
    roleId?: string | null;
    roleName?: string | null;
    branchId?: string | null;
    staffType?: string | null;
    permissions?: string[];
  }
}
