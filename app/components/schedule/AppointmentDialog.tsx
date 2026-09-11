'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { atMinutes, fmtTime, toDateKey, toHHMM } from '@/lib/datetime';
import { APPOINTMENT_TYPE, GENDER, humanize, valuesOf } from '@/lib/enums';
import { patientLabel, patientName } from '@/lib/patient-identity';

interface Resources {
  /** null for head office viewing every branch — a new patient then needs one. */
  branchId: string | null;
  chairs: { id: string; name: string; branchId?: string | null }[];
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

interface DuplicateCandidate {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  reason: 'phone' | 'name-and-dob';
}

interface Branch {
  id: string;
  name: string;
}

interface Procedure {
  id: string;
  name: string;
  durationMinutes: number | null;
  defaultPrice: number;
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** The fields the desk can realistically collect while someone is on the phone. */
const EMPTY_NEW_PATIENT = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  dateOfBirth: '',
  gender: '',
  branchId: '',
};

export default function AppointmentDialog({
  date,
  startMinutes,
  chairId,
  dentistId,
  resources,
  initialPatient,
  recallId,
  onClose,
  onBooked,
}: {
  date: Date;
  startMinutes: number;
  chairId: string | null;
  dentistId: string | null;
  resources: Resources;
  /** Preselected when booking from a patient's chart or the recall worklist. */
  initialPatient?: PatientResult | null;
  /** Links the booking back to the recall it closes. */
  recallId?: string | null;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientResult[]>([]);
  const [searchError, setSearchError] = useState('');
  const [patient, setPatient] = useState<PatientResult | null>(initialPatient ?? null);
  const [registering, setRegistering] = useState(false);
  const [newPatient, setNewPatient] = useState(EMPTY_NEW_PATIENT);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [procedures, setProcedures] = useState<Procedure[]>([]);

  const [form, setForm] = useState({
    dentistId: dentistId ?? resources.dentists[0]?.id ?? '',
    chairId: chairId ?? '',
    time: toHHMM(startMinutes),
    // Snap to a real option: at any slot size other than 15, slotMinutes * 2
    // is a value the select cannot display, so it would show "15 minutes"
    // while booking something else.
    duration: String(
      DURATIONS.find((m) => m >= resources.hours.slotMinutes * 2) ?? 30
    ),
    type: APPOINTMENT_TYPE.PROCEDURE as string,
    reasonNote: '',
    isWalkIn: false,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [registered, setRegistered] = useState<{ mrn: string } | null>(null);

  useEffect(() => {
    api
      .get<Procedure[]>('/api/procedures')
      .then(setProcedures)
      .catch(() => setProcedures([]));
  }, []);

  /*
   * One row back means the caller is tied to a single branch and there is
   * nothing to ask; several means head office, which must say where a new
   * patient is registered. Asking the endpoint beats inspecting permissions.
   */
  useEffect(() => {
    api
      .get<Branch[]>('/api/branches')
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  // Debounced patient search — the desk usually has a phone number or an MRN.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<{ rows: PatientResult[] }>(`/api/patients${qs({ q: query, pageSize: 8 })}`)
        .then((r) => {
          setResults(r.rows);
          setSearchError('');
        })
        .catch((err) => {
          // Without this a 403 or a dropped request reads as "this patient does
          // not exist", and the desk registers someone who is already on file.
          setResults([]);
          setSearchError(
            err instanceof ApiError ? err.message : 'Could not search for patients.'
          );
        });
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

  /** Head office picks a branch; a scoped user's single branch is implicit. */
  const branchChoiceNeeded = !resources.branchId && branches.length > 1;

  const registrationBranchId = useMemo(() => {
    if (resources.branchId) return resources.branchId;
    if (newPatient.branchId) return newPatient.branchId;
    // A chosen chair already says which clinic this is.
    const chair = resources.chairs.find((c) => c.id === form.chairId);
    if (chair?.branchId) return chair.branchId;
    return branches.length === 1 ? branches[0]!.id : '';
  }, [resources.branchId, resources.chairs, newPatient.branchId, form.chairId, branches]);

  const setNew = (key: keyof typeof EMPTY_NEW_PATIENT) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setNewPatient((v) => ({ ...v, [key]: e.target.value }));

  /** Carry whatever was typed into the search over to the new-patient form. */
  const startRegistering = () => {
    const typed = query.trim();
    const digits = typed.replace(/\D/g, '');
    setNewPatient({
      ...EMPTY_NEW_PATIENT,
      // A number typed into the search box is a phone number, not a name.
      ...(digits.length >= 4 && digits.length >= typed.length - 3
        ? { phone: typed }
        : { firstName: typed }),
    });
    setRegistering(true);
    setResults([]);
    setSearchError('');
  };

  const stopRegistering = () => {
    setRegistering(false);
    setNewPatient(EMPTY_NEW_PATIENT);
    setDuplicates(null);
    setFieldErrors({});
  };

  /**
   * Book against an existing record instead of registering a second one.
   *
   * Re-read rather than reusing the duplicate candidate: the candidate carries
   * no hasAlerts, and silently showing no medical alert for a patient who has
   * one is the wrong way to be wrong.
   */
  const useExistingPatient = useCallback(async (candidate: DuplicateCandidate) => {
    setError('');
    try {
      const found = await api.get<{ rows: PatientResult[] }>(
        `/api/patients${qs({ id: candidate.id, pageSize: 1 })}`
      );
      setPatient(found.rows[0] ?? { ...candidate, hasAlerts: false });
    } catch {
      setPatient({ ...candidate, hasAlerts: false });
    }
    setRegistering(false);
    setNewPatient(EMPTY_NEW_PATIENT);
    setDuplicates(null);
    setFieldErrors({});
  }, []);

  const submit = useCallback(
    async (options: { allowOverlap?: boolean; allowDuplicate?: boolean } = {}) => {
      const { allowOverlap = false, allowDuplicate = false } = options;

      if (!patient && !registering) {
        setError('Search for the patient, or add them as a new patient.');
        return;
      }
      if (registering && !newPatient.firstName.trim()) {
        setError('Please correct the highlighted fields.');
        setFieldErrors({ 'newPatient.firstName': ['First name is required'] });
        return;
      }
      if (registering && !newPatient.phone.trim()) {
        setError('Please correct the highlighted fields.');
        setFieldErrors({ 'newPatient.phone': ['A contact number is required'] });
        return;
      }
      if (registering && branchChoiceNeeded && !registrationBranchId) {
        setError('Please correct the highlighted fields.');
        setFieldErrors({ 'newPatient.branchId': ['Required'] });
        return;
      }

      setSaving(true);
      setError('');
      setFieldErrors({});
      setWarnings([]);
      setDuplicates(null);
      // Stale from an earlier clash, this would silently override the next one
      // and be audited as a deliberate double-booking.
      setConflict(false);

      try {
        const result = await api.post<{
          warnings: string[];
          patient: { mrn: string } | null;
        }>('/api/appointments', {
          ...(patient
            ? { patientId: patient.id }
            : {
                newPatient: {
                  firstName: newPatient.firstName.trim(),
                  lastName: newPatient.lastName.trim() || null,
                  phone: newPatient.phone.trim(),
                  email: newPatient.email.trim() || null,
                  dateOfBirth: newPatient.dateOfBirth || null,
                  gender: newPatient.gender || null,
                  ...(registrationBranchId ? { branchId: registrationBranchId } : {}),
                  ...(allowDuplicate ? { allowDuplicate: true } : {}),
                },
              }),
          dentistId: form.dentistId,
          chairId: form.chairId || null,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          type: form.type,
          isWalkIn: form.isWalkIn,
          reasonNote: form.reasonNote || null,
          ...(recallId ? { recallId } : {}),
          ...(allowOverlap ? { allowOverlap: true } : {}),
        });

        // Soft warnings (out of hours, on leave) and a newly issued MRN do not
        // block the booking, but the desk should still see them. `saving` stays
        // true until the dialog closes: a second click here would book twice
        // and register the patient twice.
        if (result.warnings?.length || result.patient) {
          setWarnings(result.warnings ?? []);
          setRegistered(result.patient);
          setTimeout(onBooked, result.patient ? 2200 : 1200);
          return;
        }

        onBooked();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'APPOINTMENT_CONFLICT') {
          setConflict(true);
          setError('That time is already booked.');
        } else if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
          setDuplicates((err.body.duplicates as DuplicateCandidate[]) ?? []);
        } else {
          setError(err instanceof ApiError ? err.message : 'Could not book this appointment.');
          if (err instanceof ApiError && err.details) setFieldErrors(err.details);
        }
        setSaving(false);
      }
    },
    [
      patient,
      registering,
      newPatient,
      branchChoiceNeeded,
      registrationBranchId,
      form,
      startAt,
      endAt,
      recallId,
      onBooked,
    ]
  );

  const fieldError = (name: string) => fieldErrors[name]?.[0];

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

        {(warnings.length > 0 || registered) && (
          <div className="rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/30">
            <div className="font-medium mb-0.5">
              {warnings.length ? 'Booked, with warnings' : 'Booked'}
            </div>
            {registered && (
              <p className="text-muted-foreground">
                Registered {patientName({
                  firstName: newPatient.firstName,
                  lastName: newPatient.lastName,
                })} as <span className="font-mono">{registered.mrn}</span>.
              </p>
            )}
            {warnings.length > 0 && (
              <ul className="list-disc pl-4 text-muted-foreground">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {duplicates && (
          <div className="rounded-md border border-amber-500/50 bg-amber-50/60 px-3 py-2 text-sm dark:bg-amber-950/30">
            <div className="font-medium mb-0.5">This may already be a patient</div>
            <p className="text-muted-foreground">
              Registering the same person twice splits their clinical history. Book against
              the existing record if this is them.
            </p>
            <ul className="mt-2 space-y-1">
              {duplicates.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span>
                    <Link href={`/patients/${d.id}`} className="font-medium hover:underline">
                      {patientLabel(d)}
                    </Link>
                    <span className="text-muted-foreground">
                      {' '}— {d.phone}
                      {d.reason === 'phone' ? ' · same number' : ' · same name and date of birth'}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => useExistingPatient(d)}
                  >
                    Use this record
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-2">
              <Button type="button" size="sm" variant="outline" disabled={saving}
                onClick={() => submit({ allowDuplicate: true })}>
                This is someone else — register anyway
              </Button>
            </div>
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
            ) : registering ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">New patient</span>
                  <Button type="button" size="sm" variant="ghost" onClick={stopRegistering}>
                    Search instead
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  They are registered and issued a medical record number when the appointment
                  is booked. The rest of their details can be filled in on their chart.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <NewField label="First name" required error={fieldError('newPatient.firstName')}>
                    <Input value={newPatient.firstName} onChange={setNew('firstName')} maxLength={100} autoFocus />
                  </NewField>
                  {/* lastName is nullable: plenty of patients register with one name. */}
                  <NewField label="Last name" error={fieldError('newPatient.lastName')}>
                    <Input value={newPatient.lastName} onChange={setNew('lastName')} maxLength={100} />
                  </NewField>
                  <NewField label="Phone" required error={fieldError('newPatient.phone')}>
                    <Input value={newPatient.phone} onChange={setNew('phone')} maxLength={20} placeholder="0300 1234567" />
                  </NewField>
                  <NewField
                    label="Email"
                    error={fieldError('newPatient.email')}
                    hint="Needed for the appointment reminder"
                  >
                    <Input type="email" value={newPatient.email} onChange={setNew('email')} maxLength={255} />
                  </NewField>
                  <NewField label="Date of birth" error={fieldError('newPatient.dateOfBirth')}>
                    <Input type="date" value={newPatient.dateOfBirth} onChange={setNew('dateOfBirth')} />
                  </NewField>
                  <NewField label="Gender" error={fieldError('newPatient.gender')}>
                    <select className={selectClass} value={newPatient.gender} onChange={setNew('gender')}>
                      <option value="">Not recorded</option>
                      {valuesOf(GENDER).map((g) => (
                        <option key={g} value={g}>{humanize(g)}</option>
                      ))}
                    </select>
                  </NewField>
                  {branchChoiceNeeded && (
                    <div className="sm:col-span-2">
                      <NewField
                        label="Registering branch"
                        required
                        error={fieldError('newPatient.branchId')}
                        hint="The medical record number is issued per branch"
                      >
                        <select className={selectClass} value={registrationBranchId} onChange={setNew('branchId')}>
                          <option value="">Choose a branch</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </NewField>
                    </div>
                  )}
                </div>
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
                {searchError && (
                  <p role="alert" className="text-xs text-destructive">{searchError}</p>
                )}
                {!searchError && query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-xs text-muted-foreground">No matching patients.</p>
                )}
                <Button type="button" size="sm" variant="secondary" onClick={startRegistering}>
                  Add as a new patient
                </Button>
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
              {fieldError('dentistId') && (
                <p className="text-xs text-destructive">{fieldError('dentistId')}</p>
              )}
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
                {DURATIONS.map((m) => (
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
            // Overriding a clash is deliberate and is recorded in the audit log.
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={() => submit({ allowOverlap: true })}
            >
              {saving ? 'Booking…' : 'Book anyway'}
            </Button>
          ) : (
            // Never disabled on a missing patient: a dead button explains
            // nothing, so submit() says what is needed instead.
            <Button type="button" disabled={saving} onClick={() => submit()}>
              {saving ? 'Booking…' : registering ? 'Register and book' : 'Book appointment'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewField({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
