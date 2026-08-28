'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import {
  ALL_PERMISSIONS,
  CLINICAL_PERMISSIONS,
  FINANCIAL_PERMISSIONS,
  PERMISSION_GROUPS,
} from '@/lib/permissions';

interface Role {
  id: string;
  name: string;
  permissions: string[];
  staffCount: number;
  createdAt: string;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRoles(await api.get<Role[]>('/api/roles'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load roles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(role: Role) {
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    try {
      await api.del(`/api/roles/${role.id}`);
      load();
    } catch (err) {
      // The API refuses to delete a role that staff still use, because
      // admin_users.roleId has no foreign key and they would be left pointing
      // at nothing.
      setError(err instanceof ApiError ? err.message : 'Could not delete this role.');
    }
  }

  /** Which groups a role touches — far more readable than 31 slugs. */
  const groupsFor = (permissions: string[]) =>
    PERMISSION_GROUPS.filter((g) => g.permissions.some((p) => permissions.includes(p.slug))).map(
      (g) => g.label
    );

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What each kind of staff member can reach.
          </p>
        </div>
        <Button asChild variant="success">
          <Link href="/roles/add">New role</Link>
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="text-center">Clinical</TableHead>
              <TableHead className="text-center">Financial</TableHead>
              <TableHead className="text-center">Staff</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}

            {!loading && roles.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No roles defined.
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              roles.map((role) => {
                const clinical = role.permissions.some((p) =>
                  (CLINICAL_PERMISSIONS as readonly string[]).includes(p)
                );
                const financial = role.permissions.some((p) =>
                  (FINANCIAL_PERMISSIONS as readonly string[]).includes(p)
                );

                return (
                  <TableRow key={role.id}>
                    <TableCell>
                      <Link href={`/roles/edit/${role.id}`} className="font-medium hover:underline">
                        {role.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {role.permissions.length} of {ALL_PERMISSIONS.length} permissions
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {groupsFor(role.permissions).join(' · ') || 'No access'}
                    </TableCell>
                    <TableCell className="text-center">
                      {clinical ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {financial ? <Badge variant="secondary">Yes</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center text-sm">{role.staffCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/roles/edit/${role.id}`}>Edit</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => remove(role)}
                          disabled={role.staffCount > 0}
                          title={
                            role.staffCount > 0
                              ? 'Reassign the staff using this role first'
                              : undefined
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Clinical and financial access are deliberately separate, so a dentist can
        hold clinical reporting without seeing the clinic&rsquo;s takings.
      </p>
    </div>
  );
}
