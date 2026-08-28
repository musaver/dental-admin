'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import StaffForm, { type StaffFormValues } from '@/app/components/StaffForm';
import { api, ApiError } from '@/lib/api-client';

export default function EditStaffPage() {
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<Partial<StaffFormValues> | null>(null);
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Record<string, unknown>>(`/api/admins/${id}`)
      .then((admin) => {
        setInitial({
          name: String(admin.name ?? ''),
          email: String(admin.email ?? ''),
          password: '',
          roleId: String(admin.roleId ?? ''),
          branchId: String(admin.branchId ?? ''),
          staffType: String(admin.staffType ?? 'other'),
          phone: String(admin.phone ?? ''),
          licenseNumber: String(admin.licenseNumber ?? ''),
        });
        setIsActive(admin.isActive !== false);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this account.'));
  }, [id]);

  if (error) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      </div>
    );
  }
  if (!initial) return <div className="p-4 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit staff member</h1>
      <StaffForm mode="edit" staffId={id} initial={initial} isActive={isActive} />
    </div>
  );
}
