/**
 * The clinic's authorisation vocabulary.
 *
 * These 31 slugs are not invented here — they are the exact strings already
 * stored in `admin_roles.permissions` on the live database, across the five
 * seeded roles (Admin/Owner 31, Manager 29, Dentist 15, Receptionist 13,
 * Assistant 5). Changing a slug orphans the roles that reference it.
 *
 * `admin_roles.permissions` is a `text` column holding a JSON array, not a
 * `json` column, so every read must go through parsePermissions().
 *
 * Note the deliberate separation the seeded roles rely on: the clinical slugs
 * are distinct from the billing, payments and financial-reporting ones, so a
 * dentist can hold reports_clinical without seeing the clinic's finances, and
 * an assistant can view charts without touching either.
 */

export const PERMISSIONS = {
  // Patients
  PATIENTS_VIEW: 'patients_view',
  PATIENTS_CREATE: 'patients_create',
  PATIENTS_EDIT: 'patients_edit',
  /** Archives the patient. Never a hard delete — clinical records reference them. */
  PATIENTS_DELETE: 'patients_delete',

  // Clinical
  CLINICAL_VIEW: 'clinical_view',
  CLINICAL_EDIT: 'clinical_edit',
  TREATMENT_PLANS_VIEW: 'treatment_plans_view',
  TREATMENT_PLANS_EDIT: 'treatment_plans_edit',

  // Files
  FILES_VIEW: 'files_view',
  FILES_UPLOAD: 'files_upload',
  FILES_DELETE: 'files_delete',

  // Scheduling
  APPOINTMENTS_VIEW: 'appointments_view',
  APPOINTMENTS_CREATE: 'appointments_create',
  APPOINTMENTS_EDIT: 'appointments_edit',
  APPOINTMENTS_CANCEL: 'appointments_cancel',
  RECALLS_MANAGE: 'recalls_manage',

  // Billing
  BILLING_VIEW: 'billing_view',
  BILLING_CREATE: 'billing_create',
  BILLING_WAIVE: 'billing_waive',
  PAYMENTS_RECORD: 'payments_record',
  PAYMENTS_REFUND: 'payments_refund',

  // CRM
  LEADS_VIEW: 'leads_view',
  LEADS_EDIT: 'leads_edit',

  // Reports
  REPORTS_CLINICAL: 'reports_clinical',
  REPORTS_FINANCIAL: 'reports_financial',

  // Administration
  STAFF_MANAGE: 'staff_manage',
  ROLES_MANAGE: 'roles_manage',
  SETTINGS_MANAGE: 'settings_manage',
  PROCEDURES_MANAGE: 'procedures_manage',
  AUDIT_VIEW: 'audit_view',
  EXPORT_DATA: 'export_data',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** Grouped for the role editor, with a plain-language description each. */
export const PERMISSION_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  description: string;
  permissions: ReadonlyArray<{ slug: Permission; label: string; description: string }>;
}> = [
  {
    key: 'patients',
    label: 'Patients',
    description: 'Patient records and demographics',
    permissions: [
      { slug: PERMISSIONS.PATIENTS_VIEW, label: 'View patients', description: 'Search and open patient records' },
      { slug: PERMISSIONS.PATIENTS_CREATE, label: 'Register patients', description: 'Add a new patient and issue an MRN' },
      { slug: PERMISSIONS.PATIENTS_EDIT, label: 'Edit patients', description: 'Change demographics and contact details' },
      { slug: PERMISSIONS.PATIENTS_DELETE, label: 'Archive patients', description: 'Retire a record; clinical history is retained' },
    ],
  },
  {
    key: 'clinical',
    label: 'Clinical',
    description: 'Charts, visits, diagnoses and prescriptions',
    permissions: [
      { slug: PERMISSIONS.CLINICAL_VIEW, label: 'View clinical records', description: 'Odontogram, visits, diagnoses, prescriptions' },
      { slug: PERMISSIONS.CLINICAL_EDIT, label: 'Record clinical work', description: 'Chart teeth, write notes and prescriptions' },
      { slug: PERMISSIONS.TREATMENT_PLANS_VIEW, label: 'View treatment plans', description: 'See proposed and accepted plans' },
      { slug: PERMISSIONS.TREATMENT_PLANS_EDIT, label: 'Build treatment plans', description: 'Create plans, price items, record acceptance' },
    ],
  },
  {
    key: 'files',
    label: 'Files',
    description: 'X-rays, photographs, consent forms',
    permissions: [
      { slug: PERMISSIONS.FILES_VIEW, label: 'View files', description: 'Open radiographs, photos and documents' },
      { slug: PERMISSIONS.FILES_UPLOAD, label: 'Upload files', description: 'Attach files to a patient, visit or tooth' },
      { slug: PERMISSIONS.FILES_DELETE, label: 'Delete files', description: 'Permanently remove an uploaded file' },
    ],
  },
  {
    key: 'scheduling',
    label: 'Scheduling',
    description: 'The appointment book and recalls',
    permissions: [
      { slug: PERMISSIONS.APPOINTMENTS_VIEW, label: 'View the diary', description: 'See the calendar and the check-in queue' },
      { slug: PERMISSIONS.APPOINTMENTS_CREATE, label: 'Book appointments', description: 'Create bookings and walk-ins' },
      { slug: PERMISSIONS.APPOINTMENTS_EDIT, label: 'Reschedule and update', description: 'Move appointments, check in, mark no-shows' },
      { slug: PERMISSIONS.APPOINTMENTS_CANCEL, label: 'Cancel appointments', description: 'Cancel a booking with a recorded reason' },
      { slug: PERMISSIONS.RECALLS_MANAGE, label: 'Manage recalls', description: 'Work the recall list and book follow-ups' },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Invoices, payments and refunds',
    permissions: [
      { slug: PERMISSIONS.BILLING_VIEW, label: 'View billing', description: 'See invoices, balances and the patient ledger' },
      { slug: PERMISSIONS.BILLING_CREATE, label: 'Raise invoices', description: 'Create and edit invoices' },
      { slug: PERMISSIONS.BILLING_WAIVE, label: 'Waive charges', description: 'Write off an invoice with a reason' },
      { slug: PERMISSIONS.PAYMENTS_RECORD, label: 'Record payments', description: 'Take payments, deposits and advances' },
      { slug: PERMISSIONS.PAYMENTS_REFUND, label: 'Refund and void', description: 'Issue refunds and void mistaken payments' },
    ],
  },
  {
    key: 'crm',
    label: 'Leads & CRM',
    description: 'Enquiries and conversion',
    permissions: [
      { slug: PERMISSIONS.LEADS_VIEW, label: 'View leads', description: 'See the funnel and follow-up worklist' },
      { slug: PERMISSIONS.LEADS_EDIT, label: 'Work leads', description: 'Log activity, reassign, and convert to a patient' },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Clinical and financial reporting are separate on purpose',
    permissions: [
      { slug: PERMISSIONS.REPORTS_CLINICAL, label: 'Clinical reports', description: 'Appointments, acceptance, recall compliance' },
      { slug: PERMISSIONS.REPORTS_FINANCIAL, label: 'Financial reports', description: 'Revenue, collections, outstanding balances' },
    ],
  },
  {
    key: 'admin',
    label: 'Staff & Access',
    description: 'Who works here and what they can reach',
    permissions: [
      { slug: PERMISSIONS.STAFF_MANAGE, label: 'Manage staff', description: 'Add staff, assign roles, deactivate access' },
      { slug: PERMISSIONS.ROLES_MANAGE, label: 'Manage roles', description: 'Define which permissions each role carries' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    description: 'Configuration, audit and data ownership',
    permissions: [
      { slug: PERMISSIONS.SETTINGS_MANAGE, label: 'Clinic settings', description: 'Hours, branches, chairs, message templates' },
      { slug: PERMISSIONS.PROCEDURES_MANAGE, label: 'Procedure catalogue', description: 'Maintain the price list' },
      { slug: PERMISSIONS.AUDIT_VIEW, label: 'View audit trail', description: 'Who accessed or changed a record, and when' },
      { slug: PERMISSIONS.EXPORT_DATA, label: 'Export data', description: 'Download the clinic’s data in full' },
    ],
  },
];

/** Permissions that let the holder read clinical information about a patient. */
export const CLINICAL_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.CLINICAL_VIEW,
  PERMISSIONS.CLINICAL_EDIT,
  PERMISSIONS.TREATMENT_PLANS_VIEW,
  PERMISSIONS.TREATMENT_PLANS_EDIT,
];

/** Permissions that expose money. Kept separate from clinical by design. */
export const FINANCIAL_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.BILLING_VIEW,
  PERMISSIONS.BILLING_CREATE,
  PERMISSIONS.BILLING_WAIVE,
  PERMISSIONS.PAYMENTS_RECORD,
  PERMISSIONS.PAYMENTS_REFUND,
  PERMISSIONS.REPORTS_FINANCIAL,
];

/**
 * Losing either of these locks the clinic out of its own administration, so
 * both are protected by guards in the staff and role endpoints.
 */
export const LOCKOUT_CRITICAL_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.ROLES_MANAGE,
];

/**
 * Parse `admin_roles.permissions`.
 *
 * The column is `text`, populated by application code, and one malformed row
 * must never take down the roles list — so this returns [] rather than
 * throwing, and drops any value that is not a known slug.
 */
export function parsePermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const known = new Set<string>(ALL_PERMISSIONS);
  return parsed.filter((p): p is Permission => typeof p === 'string' && known.has(p));
}

/** Serialise for storage, de-duplicated and in a stable order. */
export function serializePermissions(permissions: readonly string[]): string {
  const known = new Set<string>(ALL_PERMISSIONS);
  const unique = [...new Set(permissions)].filter((p): p is Permission => known.has(p));
  unique.sort((a, b) => ALL_PERMISSIONS.indexOf(a) - ALL_PERMISSIONS.indexOf(b));
  return JSON.stringify(unique);
}

/**
 * Does this set of permissions include the one required?
 *
 * There is deliberately NO owner bypass. `staffType === 'owner'` grants
 * nothing on its own — the Admin/Owner role holds all 31 slugs explicitly, so
 * authority is always visible in the role rather than hidden in a code branch.
 */
export function hasPermission(
  granted: readonly string[] | null | undefined,
  required: Permission
): boolean {
  return Array.isArray(granted) && granted.includes(required);
}

export function hasAnyPermission(
  granted: readonly string[] | null | undefined,
  required: readonly Permission[]
): boolean {
  return Array.isArray(granted) && required.some((r) => granted.includes(r));
}

export function hasAllPermissions(
  granted: readonly string[] | null | undefined,
  required: readonly Permission[]
): boolean {
  return Array.isArray(granted) && required.every((r) => granted.includes(r));
}

/** Human-readable label for a slug, for the audit log and role summaries. */
export function permissionLabel(slug: string): string {
  for (const group of PERMISSION_GROUPS) {
    const found = group.permissions.find((p) => p.slug === slug);
    if (found) return `${group.label}: ${found.label}`;
  }
  return slug;
}
