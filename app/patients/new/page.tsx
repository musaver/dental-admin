'use client';

import PatientForm from '@/app/components/PatientForm';

export default function NewPatientPage() {
  return (
    <div className="p-4 max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight mb-1">Register patient</h1>
      <p className="text-sm text-muted-foreground mb-6">
        A medical record number is issued automatically.
      </p>
      <PatientForm mode="create" />
    </div>
  );
}
