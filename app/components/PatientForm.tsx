'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api-client';
import { BLOOD_GROUP, GENDER, valuesOf, humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';

export interface PatientFormValues {
  firstName: string;
  lastName: string;
  phone: string;
  altPhone: string;
  email: string;
  gender: string;
  dateOfBirth: string;
  cnic: string;
  address: string;
  city: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  guardianName: string;
  bloodGroup: string;
  occupation: string;
  referredBy: string;
  defaultDiscountPercent: string;
  medicalNotes: string;
  dentalNotes: string;
}

interface DuplicateCandidate {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  reason: 'phone' | 'name-and-dob';
}

const EMPTY: PatientFormValues = {
  firstName: '', lastName: '', phone: '', altPhone: '', email: '',
  gender: '', dateOfBirth: '', cnic: '', address: '', city: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '',
  guardianName: '', bloodGroup: '', occupation: '', referredBy: '',
  defaultDiscountPercent: '0', medicalNotes: '', dentalNotes: '',
};

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function PatientForm({
  mode,
  patientId,
  initial,
}: {
  mode: 'create' | 'edit';
  patientId?: string;
  initial?: Partial<PatientFormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<PatientFormValues>({ ...EMPTY, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);

  const set = (key: keyof PatientFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setValues((v) => ({ ...v, [key]: e.target.value }));

  /** Blank strings become null; the API treats '' as "not provided". */
  const payload = (allowDuplicate = false) => ({
    ...Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])
    ),
    defaultDiscountPercent: Number(values.defaultDiscountPercent || 0),
    ...(allowDuplicate ? { allowDuplicate: true } : {}),
  });

  async function submit(allowDuplicate = false) {
    setSaving(true);
    setError('');
    setFieldErrors({});
    if (!allowDuplicate) setDuplicates(null);

    try {
      const saved =
        mode === 'create'
          ? await api.post<{ id: string }>('/api/patients', payload(allowDuplicate))
          : await api.put<{ id: string }>(`/api/patients/${patientId}`, payload(true));

      router.push(`/patients/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        // 409 with candidates: the server thinks this person may already exist.
        if (err.code === 'POSSIBLE_DUPLICATE') {
          setDuplicates((err.body.duplicates as DuplicateCandidate[]) ?? []);
        } else {
          setError(err.message);
          if (err.details) setFieldErrors(err.details);
        }
      } else {
        setError('Could not save this patient.');
      }
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {duplicates && (
        <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base">This may already be an existing patient</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Registering the same person twice splits their clinical history. Open the existing
              record if this is them.
            </p>
            <ul className="space-y-1">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/patients/${d.id}`} className="font-medium hover:underline">
                    {patientName(d)} ({d.mrn})
                  </Link>
                  <span className="text-muted-foreground">
                    {' '}— {d.phone}
                    {d.reason === 'phone' ? ' · same phone number' : ' · same name and date of birth'}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setDuplicates(null)}>
                Go back and edit
              </Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => submit(true)}>
                {saving ? 'Registering…' : 'This is a different person — register anyway'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldError('firstName')}>
            <Input value={values.firstName} onChange={set('firstName')} required maxLength={100} />
          </Field>
          {/* lastName is nullable in the schema: plenty of patients register with one name. */}
          <Field label="Last name" error={fieldError('lastName')}>
            <Input value={values.lastName} onChange={set('lastName')} maxLength={100} />
          </Field>
          <Field label="Date of birth" error={fieldError('dateOfBirth')}>
            <Input type="date" value={values.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label="Gender" error={fieldError('gender')}>
            <select className={selectClass} value={values.gender} onChange={set('gender')}>
              <option value="">Not recorded</option>
              {valuesOf(GENDER).map((g) => (
                <option key={g} value={g}>{humanize(g)}</option>
              ))}
            </select>
          </Field>
          <Field label="CNIC" error={fieldError('cnic')}>
            <Input value={values.cnic} onChange={set('cnic')} maxLength={15} placeholder="42101-1234567-1" />
          </Field>
          <Field label="Blood group" error={fieldError('bloodGroup')}>
            <select className={selectClass} value={values.bloodGroup} onChange={set('bloodGroup')}>
              <option value="">Not recorded</option>
              {BLOOD_GROUP.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {/* The only required contact field — email is nullable. */}
          <Field label="Phone" required error={fieldError('phone')} hint="Used to find existing records">
            <Input value={values.phone} onChange={set('phone')} required maxLength={20} placeholder="0300 1234567" />
          </Field>
          <Field label="Alternative phone" error={fieldError('altPhone')}>
            <Input value={values.altPhone} onChange={set('altPhone')} maxLength={20} />
          </Field>
          <Field label="Email" error={fieldError('email')} hint="Needed for portal access and reminders">
            <Input type="email" value={values.email} onChange={set('email')} maxLength={255} />
          </Field>
          <Field label="City" error={fieldError('city')}>
            <Input value={values.city} onChange={set('city')} maxLength={100} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address" error={fieldError('address')}>
              <Textarea value={values.address} onChange={set('address')} rows={2} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Emergency contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" error={fieldError('emergencyContactName')}>
            <Input value={values.emergencyContactName} onChange={set('emergencyContactName')} maxLength={255} />
          </Field>
          <Field label="Phone" error={fieldError('emergencyContactPhone')}>
            <Input value={values.emergencyContactPhone} onChange={set('emergencyContactPhone')} maxLength={20} />
          </Field>
          <Field label="Relationship" error={fieldError('emergencyContactRelation')}>
            <Input value={values.emergencyContactRelation} onChange={set('emergencyContactRelation')} maxLength={50} />
          </Field>
          <Field label="Guardian" error={fieldError('guardianName')} hint="For a minor">
            <Input value={values.guardianName} onChange={set('guardianName')} maxLength={255} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clinical &amp; billing notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Occupation" error={fieldError('occupation')}>
            <Input value={values.occupation} onChange={set('occupation')} maxLength={100} />
          </Field>
          <Field label="Referred by" error={fieldError('referredBy')}>
            <Input value={values.referredBy} onChange={set('referredBy')} maxLength={255} />
          </Field>
          <Field
            label="Default discount (%)"
            error={fieldError('defaultDiscountPercent')}
            hint="Applied as a line on new invoices"
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={values.defaultDiscountPercent}
              onChange={set('defaultDiscountPercent')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Medical notes"
              error={fieldError('medicalNotes')}
              hint="Allergies and conditions are recorded separately as alerts"
            >
              <Textarea value={values.medicalNotes} onChange={set('medicalNotes')} rows={3} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Dental notes" error={fieldError('dentalNotes')}>
              <Textarea value={values.dentalNotes} onChange={set('dentalNotes')} rows={3} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Register patient' : 'Save changes'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
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
