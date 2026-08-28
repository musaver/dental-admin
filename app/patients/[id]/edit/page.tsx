'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PatientForm, { type PatientFormValues } from '@/app/components/PatientForm';
import { api, ApiError } from '@/lib/api-client';
import { toDateKey } from '@/lib/datetime';

/** A date input needs 'YYYY-MM-DD'; the API returns an ISO datetime. */
function dateInputValue(value: string | null): string {
  return value ? toDateKey(new Date(value)) : '';
}

export default function EditPatientPage() {
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<Partial<PatientFormValues> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Record<string, string | number | null>>(`/api/patients/${id}`)
      .then((p) =>
        setInitial({
          firstName: String(p.firstName ?? ''),
          lastName: String(p.lastName ?? ''),
          phone: String(p.phone ?? ''),
          altPhone: String(p.altPhone ?? ''),
          email: String(p.email ?? ''),
          gender: String(p.gender ?? ''),
          dateOfBirth: dateInputValue(p.dateOfBirth as string | null),
          cnic: String(p.cnic ?? ''),
          address: String(p.address ?? ''),
          city: String(p.city ?? ''),
          emergencyContactName: String(p.emergencyContactName ?? ''),
          emergencyContactPhone: String(p.emergencyContactPhone ?? ''),
          emergencyContactRelation: String(p.emergencyContactRelation ?? ''),
          guardianName: String(p.guardianName ?? ''),
          bloodGroup: String(p.bloodGroup ?? ''),
          occupation: String(p.occupation ?? ''),
          referredBy: String(p.referredBy ?? ''),
          defaultDiscountPercent: String(p.defaultDiscountPercent ?? 0),
          medicalNotes: String(p.medicalNotes ?? ''),
          dentalNotes: String(p.dentalNotes ?? ''),
        })
      )
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load this patient.')
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

  if (!initial) return <div className="p-4 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-4 max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit patient</h1>
      <PatientForm mode="edit" patientId={id} initial={initial} />
    </div>
  );
}
