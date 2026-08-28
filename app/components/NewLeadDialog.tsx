'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { humanize, LEAD_SOURCE, valuesOf } from '@/lib/enums';

interface Procedure { id: string; name: string }

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/** Capture an enquiry: name, number, where they came from, what they want. */
export default function NewLeadDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '', phone: '', email: '', source: 'walk_in',
    interestedProcedureId: '', interestNote: '', nextFollowUpAt: '',
  });
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Procedure[]>('/api/procedures').then(setProcedures).catch(() => setProcedures([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/leads', {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        source: form.source,
        interestedProcedureId: form.interestedProcedureId || null,
        interestNote: form.interestNote.trim() || null,
        nextFollowUpAt: form.nextFollowUpAt ? `${form.nextFollowUpAt}T09:00:00` : null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the enquiry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New enquiry</DialogTitle></DialogHeader>
        {error && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="leadName">Name <span className="text-destructive">*</span></Label>
            <Input id="leadName" required maxLength={255} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="leadPhone">Phone <span className="text-destructive">*</span></Label>
              <Input id="leadPhone" required maxLength={20} placeholder="0300 1234567" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leadEmail">Email</Label>
              <Input id="leadEmail" type="email" maxLength={255} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leadSource">How they found us</Label>
              <select id="leadSource" className={selectClass} value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {valuesOf(LEAD_SOURCE).map((s) => (
                  <option key={s} value={s}>{humanize(s)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leadFollowUp">Follow up on</Label>
              <Input id="leadFollowUp" type="date" value={form.nextFollowUpAt}
                onChange={(e) => setForm({ ...form, nextFollowUpAt: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leadProcedure">Interested in</Label>
            <select id="leadProcedure" className={selectClass} value={form.interestedProcedureId}
              onChange={(e) => setForm({ ...form, interestedProcedureId: e.target.value })}>
              <option value="">Not sure yet</option>
              {procedures.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="leadNote">Note</Label>
            <Input id="leadNote" maxLength={255} placeholder="Wants a quote for whitening" value={form.interestNote}
              onChange={(e) => setForm({ ...form, interestNote: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.name.trim() || !form.phone.trim()}>
              {busy ? 'Saving…' : 'Save enquiry'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
