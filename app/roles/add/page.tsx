'use client';

import RoleForm from '@/app/components/RoleForm';

export default function AddRolePage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-1">New role</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Choose what this role can reach. Clinical and financial access are kept
        separate so a dentist can hold clinical reporting without seeing the
        clinic&rsquo;s takings.
      </p>
      <RoleForm mode="create" />
    </div>
  );
}
