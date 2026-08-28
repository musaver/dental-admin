'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import RoleForm from '@/app/components/RoleForm';
import { api, ApiError } from '@/lib/api-client';

interface RoleResponse {
  id: string;
  name: string;
  permissions: string | string[];
}

export default function EditRolePage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<{ name: string; permissions: string[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<RoleResponse>(`/api/roles/${id}`)
      .then((r) => {
        // The column is `text` holding JSON, so the API may hand back either
        // an array or the raw string. One malformed row must not blank the form.
        let permissions: string[] = [];
        if (Array.isArray(r.permissions)) {
          permissions = r.permissions;
        } else if (typeof r.permissions === 'string') {
          try {
            const parsed = JSON.parse(r.permissions);
            if (Array.isArray(parsed)) permissions = parsed;
          } catch {
            permissions = [];
          }
        }
        setRole({ name: r.name, permissions });
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this role.')
      );
  }, [id]);

  if (error) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!role) return <div className="p-4 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit role</h1>
      <RoleForm
        mode="edit"
        roleId={id}
        initialName={role.name}
        initialPermissions={role.permissions}
      />
    </div>
  );
}
