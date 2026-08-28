'use client';

import StaffForm from '@/app/components/StaffForm';

export default function AddStaffPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">New staff member</h1>
      <StaffForm mode="create" />
    </div>
  );
}
