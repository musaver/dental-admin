'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, type Permission } from '@/lib/permissions';

/**
 * Role editor over the 31 dental permission slugs.
 *
 * The slugs are not arbitrary: they are exactly what the five seeded roles
 * already store in admin_roles.permissions, so renaming one orphans every role
 * that holds it.
 *
 * Grouped rather than presented as a flat list of 31 checkboxes, because the
 * groups are where the meaningful decision lives — particularly the split
 * between clinical access and financial access, which is what lets a dentist
 * hold clinical reporting without seeing the clinic's takings.
 */
export default function RoleForm({
  mode,
  roleId,
  initialName = '',
  initialPermissions = [],
}: {
  mode: 'create' | 'edit';
  roleId?: string;
  initialName?: string;
  initialPermissions?: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [granted, setGranted] = useState<Set<string>>(new Set(initialPermissions));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (slug: Permission) =>
    setGranted((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const toggleGroup = (slugs: readonly Permission[], on: boolean) =>
    setGranted((current) => {
      const next = new Set(current);
      for (const slug of slugs) {
        if (on) next.add(slug);
        else next.delete(slug);
      }
      return next;
    });

  const summary = useMemo(() => {
    const held = ALL_PERMISSIONS.filter((p) => granted.has(p));
    return { count: held.length, total: ALL_PERMISSIONS.length };
  }, [granted]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = { name: name.trim(), permissions: [...granted] };

    try {
      if (mode === 'create') await api.post('/api/roles', payload);
      else await api.put(`/api/roles/${roleId}`, payload);
      router.push('/roles');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-3xl">
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="roleName">Name</Label>
          <Input
            id="roleName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={255}
            placeholder="Dentist"
            className="max-w-sm"
          />
          <p className="text-sm text-muted-foreground pt-1">
            {summary.count} of {summary.total} permissions granted.
          </p>
        </CardContent>
      </Card>

      {PERMISSION_GROUPS.map((group) => {
        const slugs = group.permissions.map((p) => p.slug);
        const allOn = slugs.every((s) => granted.has(s));
        const someOn = slugs.some((s) => granted.has(s));

        return (
          <Card key={group.key}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-4">
              <div>
                <CardTitle className="text-base">{group.label}</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{group.description}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => toggleGroup(slugs, !allOn)}
              >
                {allOn ? 'Clear all' : someOn ? 'Select all' : 'Select all'}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <label
                  key={permission.slug}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 -m-2 transition-colors hover:bg-muted/60"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input"
                    checked={granted.has(permission.slug)}
                    onChange={() => toggle(permission.slug)}
                  />
                  <span className="text-sm leading-tight">
                    <span className="font-medium">{permission.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {permission.description}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create role' : 'Save changes'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/roles')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
