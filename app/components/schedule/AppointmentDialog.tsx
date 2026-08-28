'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, qs, ApiError } from '@/lib/api-client';
import { atMinutes, fmtTime, minutesSinceMidnight, toDateKey, toHHMM } from '@/lib/datetime';
import { APPOINTMENT_TYPE, humanize, valuesOf } from '@/lib/enums';
import { patientLabel } from '@/lib/patient-identity';

interface Resources {
  chairs: { id: string; name: string }[];
  dentists: { id: string; name: string | null }[];
  hours: { workStartMinutes: number; workEndMinutes: number; slotMinutes: number };
}

interface PatientResult {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  hasAlerts: boolean;
}

interface Procedure {
  id: string;
  name: string;
  durationMinutes: number | null;
  defaultPrice: number;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function AppointmentDialog({
  date,
  startMinutes,
  chairId,
  dentistId,
  resources,
  onClose,
  onBooked,
}: {
  date: Date;
  startMinutes: number;
  chairId: string | null;
  dentistId: string | null;
  resources: Resources;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientResult[]>([]);
  const [patient, setPatient] = useState<PatientResult | null>(null);
  const [procedures, setProcedures] = useState<Procedure[]>([]);

  const [form, setForm] = useState({
    dentistId: dentistId ?? resources.dentists[0]?.id ?? '',
    chairId: chairId ?? '',
    time: toHHMM(startMinutes),
    duration: String(resources.hours.slotMinutes * 2),
    type: APPOINTMENT_TYPE.PROCEDURE as string,
    reasonNote: '',
    isWalkIn: false,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    api
      .get<Procedure[]>('/api/procedures')
      .then(setProcedures)
      .catch(() => setProcedures([]));
  }, []);

  // Debounced patient search — the desk usually has a phone number or an MRN.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ rows: PatientResult[] }>(`/api/patients${qs({ q: query, pageSize: 8 })}`)
        .then((r) => setResults(r.rows))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const startAt = useMemo(() => {
    const [h, m] = form.time.split(':').map(Number);
    return atMinutes(date, (h ?? 9) * 60 + (m ?? 0));
  }, [date, form.time]);

  const endAt = useMemo(
    () => new Date(startAt.getTime() + Number(form.duration || 30) * 60_000),
    [startAt, form.duration]
  );

  const submit = useCallback(
    async (allowOverlap: boolean) => {
      if (!patient) {
        setError('Choose a patient first.');
        return;
      }
      setSaving(true);
      setError('');
      setWarnings([]);

      try {
        const result = await api.post<{ warnings: string[] }>('/api/appointments', {
          patientId: patient.id,
          dentistId: form.dentistId,
          chairId: form.chairId || null,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          type: form.type,
          isWalkIn: form.isWalkIn,
          reasonNote: form.reasonNote || null,
          ...(allowOverlap ? { allowOverlap: true } : {}),
        });

        // Soft warnings (out of hours, on leave) do not block the booking, but
        // the desk should still see them.
        if (result.warnings?.length) {
          setWarnings(result.warnings);
          setTimeout(onBooked, 1200);
        } else {
          onBooked();
        }
      } catch (err) {
        if (err instanceof ApiError && err.code === 'APPOINTMENT_CONFLICT') {
          setConflict(true);
          setError('That time is already booked.');
        } else {
          setError(err instanceof ApiError ? err.message : 'Could not book this appointment.');
        }
      } finally {
        setSaving(false);
      }
    },
    [patient, form, startAt, endAt, onBooked]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
        </DialogHeader>

        {error && (
          <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/30">
            <div className="font-medium mb-0.5">Booked, with warnings</div>
            <ul className="list-disc pl-4 text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4">
          {/* Patient */}
          <div className="space-y-1.5">
            <Label htmlFor="patientSearch">Patient</Label>
            {patient ? (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{patientLabel(patient)}</span>
                  <span className="text-muted-foreground"> · {patient.phone}</span>
                  {patient.hasAlerts && (
                    <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                      Medical alert
                    </span>
                  )}
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPatient(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="patientSearch"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, MRN or phone"
                  autoFocus
                />
                {results.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-md border divide-y">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setPatient(r);
                            setResults([]);
                            setQuery('');
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span>{patientLabel(r)}</span>
                          <span className="text-muted-foreground font-mono text-xs">{r.phone}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-xs text-muted-foreground">No matching patients.</p>
                )}
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dentist">Dentist</Label>
              <select
                id="dentist"
                className={selectClass}
                value={form.dentistId}
                onChange={(e) => setForm({ ...form, dentistId: e.target.value })}
              >
                {resources.dentists.map((d) => (
                  <option key={d.id} value={d.id}>{d.name ?? 'Unnamed'}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="chair">Chair</Label>
              <select
                id="chair"
                className={selectClass}
                value={form.chairId}
                onChange={(e) => setForm({ ...form, chairId: e.target.value })}
              >
                {/* chairId is nullable, so "unassigned" is a real option. */}
                <option value="">Unassigned</option>
                {resources.chairs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="time">Start</Label>
              <Input
                id="time"
                type="time"
                step={resources.hours.slotMinutes * 60}
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="duration">Duration</Label>
              <select
                id="duration"
                className={selectClass}
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
              >
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>{m} minutes</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className={selectClass}
                value={form.type}
                onChange={(e) => {
                  const next = e.target.value;
                  // Pre-fill a sensible duration from the catalogue when the
                  // appointment is a consultation or check-up.
                  const match = procedures.find(
                    (p) => p.name.toLowerCase().includes(next.replace(/_/g, ' '))
                  );
                  setForm({
                    ...form,
                    type: next,
                    duration: match?.durationMinutes ? String(match.durationMinutes) : form.duration,
                  });
                }}
              >
                {valuesOf(APPOINTMENT_TYPE).map((t) => (
                  <option key={t} value={t}>{humanize(t)}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={form.isWalkIn}
                  onChange={(e) => setForm({ ...form, isWalkIn: e.target.checked })}
                />
                Walk-in
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              rows={2}
              value={form.reasonNote}
              onChange={(e) => setForm({ ...form, reasonNote: e.target.value })}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {toDateKey(date)} · {fmtTime(startAt)}–{fmtTime(endAt)}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {conflict ? (
            // Overriding a clash is deliberate, needs appointments_edit, and is
            // recorded in the audit log.
            <Button type="button" variant="destructive" disabled={saving} onClick={() => submit(true)}>
              {saving ? 'Booking…' : 'Book anyway'}
            </Button>
          ) : (
            <Button type="button" disabled={saving || !patient} onClick={() => submit(false)}>
              {saving ? 'Booking…' : 'Book appointment'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
