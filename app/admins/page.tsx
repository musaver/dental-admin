'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { humanize } from '@/lib/enums';

interface StaffRow {
  admin: {
    id: string;
    name: string | null;
    email: string;
    staffType: string | null;
    branchId: string | null;
    isActive: boolean | null;
  };
  role: { id: string; name: string } | null;
}

/**
 * Staff list. No delete button — deactivation is the only way access ends
 * (the API returns 405 for delete), so an inactive account shows dimmed with a
 * reactivate path through its edit page instead.
 */
export default function StaffPage() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api.get<StaffRow[]>('/api/admins'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Accounts and their roles.</p>
        </div>
        <Button asChild variant="success">
          <Link href="/admins/add">New staff member</Link>
        </Button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No staff yet.</TableCell></TableRow>
            )}
            {!loading && rows.map(({ admin, role }) => (
              <TableRow key={admin.id} className={admin.isActive === false ? 'opacity-50' : ''}>
                <TableCell className="font-medium">
                  {admin.name || '—'}
                  {admin.isActive === false && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">{admin.email}</TableCell>
                <TableCell>{role?.name ?? 'No role'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {admin.staffType ? humanize(admin.staffType) : '—'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {admin.branchId ? 'Branch' : 'Head office'}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/admins/edit/${admin.id}`}>Edit</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
