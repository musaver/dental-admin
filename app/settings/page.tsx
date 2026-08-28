'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api-client';

interface SettingsData {
  settings: {
    clinicName: string; address: string | null; phone: string | null; email: string | null;
    workStartTime: string; workEndTime: string; slotMinutes: number; currency: string;
  };
  branches: { id: string; name: string; code: string; isActive: boolean | null }[];
  chairs: { id: string; name: string; branchId: string; isActive: boolean | null }[];
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<SettingsData['settings'] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.get<SettingsData>('/api/settings');
      setData(result);
      setForm(result.settings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/api/settings', {
        clinicName: form.clinicName,
        address: form.address,
        phone: form.phone,
        email: form.email,
        workStartTime: form.workStartTime,
        workEndTime: form.workEndTime,
        slotMinutes: form.slotMinutes,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (error && !form) return <div className="p-4"><div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div></div>;
  if (!data || !form) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const set = (patch: Partial<SettingsData['settings']>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {saved && <div className="rounded-md border border-emerald-500/40 bg-emerald-50/60 px-3 py-2 text-sm dark:bg-emerald-950/30">Saved.</div>}

      <Card>
        <CardHeader><CardTitle className="text-base">Clinic</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="clinicName">Name</Label>
            <Input id="clinicName" value={form.clinicName} onChange={(e) => set({ clinicName: e.target.value })} />
            <p className="text-xs text-muted-foreground">Appears on emails and printed documents.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email (reply-to)</Label>
            <Input id="email" type="email" value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" rows={2} value={form.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Opening hours</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="start">Opens</Label>
            <Input id="start" type="time" value={form.workStartTime} onChange={(e) => set({ workStartTime: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end">Closes</Label>
            <Input id="end" type="time" value={form.workEndTime} onChange={(e) => set({ workEndTime: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot">Slot length</Label>
            <select id="slot" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.slotMinutes} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
              {[10, 15, 20, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Currency is {form.currency}; all amounts are whole rupees.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Branches &amp; chairs</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {data.branches.map((branch) => (
            <div key={branch.id}>
              <span className="font-medium">{branch.name}</span>
              <span className="font-mono text-xs text-muted-foreground"> ({branch.code})</span>
              <span className="text-muted-foreground">
                {' — '}
                {data.chairs.filter((c) => c.branchId === branch.id).map((c) => c.name).join(', ') || 'no chairs'}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            Adding branches and chairs is a later-phase feature; the seeded Main Branch is active.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</Button>
        <Link href="/settings/templates" className="text-sm text-muted-foreground hover:text-foreground">
          Message templates →
        </Link>
      </div>
    </div>
  );
}
