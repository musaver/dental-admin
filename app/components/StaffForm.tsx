'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { humanize, STAFF_TYPE, valuesOf } from '@/lib/enums';

interface Role { id: string; name: string }
interface Branch { id: string; name: string }

export interface StaffFormValues {
  name: string;
  email: string;
  password: string;
  roleId: string;
  branchId: string;
  staffType: string;
  phone: string;
  licenseNumber: string;
}

const EMPTY: StaffFormValues = {
  name: '', email: '', password: '', roleId: '',
  branchId: '', staffType: 'other', phone: '', licenseNumber: '',
};

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/**
 * The staff form, covering the dental columns the old form ignored:
 * staff type, branch, phone, and the licence number that prints on
 * prescriptions. Branch left empty means head office — visible everywhere.
 */
export default function StaffForm({
  mode,
  staffId,
  initial,
  isActive,
}: {
  mode: 'create' | 'edit';
  staffId?: string;
  initial?: Partial<StaffFormValues>;
  isActive?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<StaffFormValues>({ ...EMPTY, ...initial });
  const [roles, setRoles] = useState<Role[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    api.get<Role[]>('/api/roles').then(setRoles).catch(() => setRoles([]));
    api
      .get<{ branches: Branch[] }>('/api/settings')
      .then((d) => setBranches(d.branches))
      // Without settings_manage the branch list stays empty; that is fine —
      // the field simply offers head office only.
      .catch(() => setBranches([]));
  }, []);

  const set = (key: keyof StaffFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFieldErrors({});

    const payload: Record<string, unknown> = {
      name: values.name.trim() || null,
      email: values.email.trim(),
      roleId: values.roleId,
      branchId: values.branchId || null,
      staffType: values.staffType,
      phone: values.phone.trim() || null,
      licenseNumber: values.licenseNumber.trim() || null,
    };
    if (values.password) payload.password = values.password;

    try {
      if (mode === 'create') await api.post('/api/admins', payload);
      else await api.put(`/api/admins/${staffId}`, payload);
      router.push('/admins');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details) setFieldErrors(err.details);
      } else {
        setError('Could not save this staff member.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!staffId) return;
    const deactivating = isActive !== false;
    if (
      deactivating &&
      !confirm('Deactivate this account? Their access ends on their next request.')
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/admins/${staffId}/status`, { isActive: !deactivating ? true : false });
      router.push('/admins');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the account status.');
      setBusy(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <form onSubmit={submit} className="space-y-4 max-w-lg">
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="staffName">Name</Label>
            <Input id="staffName" value={values.name} onChange={set('name')} maxLength={255} />
            {fieldError('name') && <p className="text-xs text-destructive">{fieldError('name')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staffEmail">Email <span className="text-destructive">*</span></Label>
            <Input id="staffEmail" type="email" required value={values.email} onChange={set('email')} />
            {fieldError('email') && <p className="text-xs text-destructive">{fieldError('email')}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="staffPassword">
              {mode === 'create' ? 'Password' : 'New password'}
              {mode === 'create' && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              id="staffPassword"
              type="password"
              autoComplete="new-password"
              required={mode === 'create'}
              minLength={10}
              value={values.password}
              onChange={set('password')}
              placeholder={mode === 'edit' ? 'Leave empty to keep the current one' : 'At least 10 characters'}
            />
            {fieldError('password') && <p className="text-xs text-destructive">{fieldError('password')}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Role &amp; place</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="staffRole">Role <span className="text-destructive">*</span></Label>
            <select id="staffRole" className={selectClass} required value={values.roleId} onChange={set('roleId')}>
              <option value="">Choose a role…</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
            {fieldError('roleId') && <p className="text-xs text-destructive">{fieldError('roleId')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staffType">Staff type</Label>
            <select id="staffType" className={selectClass} value={values.staffType} onChange={set('staffType')}>
              {valuesOf(STAFF_TYPE).map((type) => (
                <option key={type} value={type}>{humanize(type)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staffBranch">Branch</Label>
            <select id="staffBranch" className={selectClass} value={values.branchId} onChange={set('branchId')}>
              <option value="">Head office (all branches)</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              A branch confines what this person sees; head office sees everything.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staffPhone">Phone</Label>
            <Input id="staffPhone" value={values.phone} onChange={set('phone')} maxLength={20} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="staffLicense">Licence number</Label>
            <Input id="staffLicense" value={values.licenseNumber} onChange={set('licenseNumber')} maxLength={50} />
            <p className="text-xs text-muted-foreground">Printed on prescriptions for clinical staff.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create account' : 'Save changes'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push('/admins')}>Cancel</Button>
        {mode === 'edit' && (
          <Button
            type="button"
            variant={isActive === false ? 'success' : 'destructive'}
            disabled={busy}
            onClick={toggleActive}
            className="ml-auto"
          >
            {isActive === false ? 'Reactivate account' : 'Deactivate account'}
          </Button>
        )}
      </div>
      {mode === 'edit' && (
        <p className="text-xs text-muted-foreground">
          Deactivation ends access on their next request. Accounts are never deleted — clinical
          records reference them.
        </p>
      )}
    </form>
  );
}
