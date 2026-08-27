/**
 * Controlled vocabularies for the ~40 enum-like columns in the schema.
 *
 * Every one of these is a bare `varchar` — the database has no MySQL ENUMs and
 * no CHECK constraints, so nothing stops a typo from being persisted forever.
 * This module is the single source of truth: import the constant, never write
 * a bare string literal at a call site.
 *
 * Each group records the column it belongs to, its varchar width, and its
 * database DEFAULT (or that it has none, in which case application code must
 * always supply a value explicitly).
 *
 * scripts/check-enums.mjs asserts that no value here exceeds its column width
 * — an overflow throws at INSERT time in strict mode, in production, midway
 * through a clinical save.
 */

/* ── Scheduling ──────────────────────────────────────────────────────── */

/** appointments.status — varchar(20), default 'scheduled'. */
export const APPOINTMENT_STATUS = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  CHECKED_IN: 'checked_in',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  /** No dedicated column exists; a no-show is only ever this status. */
  NO_SHOW: 'no_show',
} as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];

/**
 * Statuses that still occupy their slot. A cancelled or no-show appointment
 * frees the chair, so the availability engine must exclude exactly these two.
 */
export const BLOCKING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  APPOINTMENT_STATUS.SCHEDULED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.CHECKED_IN,
  APPOINTMENT_STATUS.IN_PROGRESS,
  APPOINTMENT_STATUS.COMPLETED,
];

/** appointments.type — varchar(20), default 'procedure'. */
export const APPOINTMENT_TYPE = {
  CONSULTATION: 'consultation',
  PROCEDURE: 'procedure',
  CHECKUP: 'checkup',
  EMERGENCY: 'emergency',
  FOLLOW_UP: 'follow_up',
} as const;
export type AppointmentType = (typeof APPOINTMENT_TYPE)[keyof typeof APPOINTMENT_TYPE];

/** recalls.status — varchar(20), default 'pending'. */
export const RECALL_STATUS = {
  PENDING: 'pending',
  CONTACTED: 'contacted',
  BOOKED: 'booked',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  // 'overdue' is deliberately NOT a stored status. It is derived in the
  // worklist query (pending AND dueDate <= now), so there is no second source
  // of truth and no batch job to keep it accurate.
} as const;
export type RecallStatus = (typeof RECALL_STATUS)[keyof typeof RECALL_STATUS];

/* ── Clinical ────────────────────────────────────────────────────────── */

/** visits.status — varchar(20), default 'in_progress'. */
export const VISIT_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type VisitStatus = (typeof VISIT_STATUS)[keyof typeof VISIT_STATUS];

/** visit_procedures.status — varchar(20), default 'completed'. */
export const VISIT_PROCEDURE_STATUS = {
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  CANCELLED: 'cancelled',
} as const;
export type VisitProcedureStatus =
  (typeof VISIT_PROCEDURE_STATUS)[keyof typeof VISIT_PROCEDURE_STATUS];

/** tooth_conditions.status — varchar(20), default 'active'. */
export const TOOTH_CONDITION_STATUS = {
  /** Current chart state is every row with this status. */
  ACTIVE: 'active',
  PLANNED: 'planned',
  TREATED: 'treated',
  RESOLVED: 'resolved',
  WATCH: 'watch',
} as const;
export type ToothConditionStatus =
  (typeof TOOTH_CONDITION_STATUS)[keyof typeof TOOTH_CONDITION_STATUS];

/** tooth_conditions.conditionType — varchar(30), NO DEFAULT. */
export const TOOTH_CONDITION_TYPE = {
  CARIES: 'caries',
  RESTORATION: 'restoration',
  MISSING: 'missing',
  CROWN: 'crown',
  BRIDGE: 'bridge',
  IMPLANT: 'implant',
  RCT: 'rct',
  FRACTURE: 'fracture',
  IMPACTED: 'impacted',
  MOBILITY: 'mobility',
  RECESSION: 'recession',
  ATTRITION: 'attrition',
  DISCOLOURATION: 'discolouration',
  SEALANT: 'sealant',
  EXTRACTION: 'extraction',
  VENEER: 'veneer',
  OTHER: 'other',
} as const;
export type ToothConditionType =
  (typeof TOOTH_CONDITION_TYPE)[keyof typeof TOOTH_CONDITION_TYPE];

/** patient_conditions.conditionType — varchar(20), NO DEFAULT. Whole-patient, not per-tooth. */
export const PATIENT_CONDITION_TYPE = {
  MEDICAL: 'medical',
  ALLERGY: 'allergy',
  MEDICATION: 'medication',
  HABIT: 'habit',
  DENTAL: 'dental',
} as const;
export type PatientConditionType =
  (typeof PATIENT_CONDITION_TYPE)[keyof typeof PATIENT_CONDITION_TYPE];

/** patient_conditions.severity — varchar(20), nullable, no default. */
export const CONDITION_SEVERITY = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
} as const;
export type ConditionSeverity = (typeof CONDITION_SEVERITY)[keyof typeof CONDITION_SEVERITY];

/** patient_conditions.status — varchar(20), default 'active'. */
export const PATIENT_CONDITION_STATUS = {
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  INACTIVE: 'inactive',
} as const;
export type PatientConditionStatus =
  (typeof PATIENT_CONDITION_STATUS)[keyof typeof PATIENT_CONDITION_STATUS];

/* ── Treatment planning ──────────────────────────────────────────────── */

/** treatment_plans.status — varchar(20), default 'draft'. */
export const TREATMENT_PLAN_STATUS = {
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;
export type TreatmentPlanStatus =
  (typeof TREATMENT_PLAN_STATUS)[keyof typeof TREATMENT_PLAN_STATUS];

/** treatment_plan_items.status — varchar(20), default 'pending'. */
export const TREATMENT_PLAN_ITEM_STATUS = {
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;
export type TreatmentPlanItemStatus =
  (typeof TREATMENT_PLAN_ITEM_STATUS)[keyof typeof TREATMENT_PLAN_ITEM_STATUS];

/**
 * treatment_plan_items.discountType — varchar(20), nullable.
 * Pairs with discountValue, which means percent OR absolute depending on this.
 * Matches the vocabulary lib/money.ts already implements.
 */
export const DISCOUNT_TYPE = {
  PERCENTAGE: 'percentage',
  FIXED: 'fixed',
} as const;
export type DiscountType = (typeof DISCOUNT_TYPE)[keyof typeof DISCOUNT_TYPE];

/** procedures.category — varchar(30). These 10 are the seeded values. */
export const PROCEDURE_CATEGORY = {
  PREVENTIVE: 'preventive',
  DIAGNOSTIC: 'diagnostic',
  RESTORATIVE: 'restorative',
  ENDODONTIC: 'endodontic',
  PERIODONTIC: 'periodontic',
  PROSTHODONTIC: 'prosthodontic',
  SURGICAL: 'surgical',
  ORTHODONTIC: 'orthodontic',
  PEDIATRIC: 'pediatric',
  COSMETIC: 'cosmetic',
} as const;
export type ProcedureCategory = (typeof PROCEDURE_CATEGORY)[keyof typeof PROCEDURE_CATEGORY];

/**
 * recalls.recallType — varchar(30), NO DEFAULT.
 * Auto-generated recalls reuse the source procedure's category verbatim, so
 * the vocabularies are deliberately the same shape plus 'custom'.
 */
export const RECALL_TYPE = {
  ...PROCEDURE_CATEGORY,
  CUSTOM: 'custom',
} as const;
export type RecallType = (typeof RECALL_TYPE)[keyof typeof RECALL_TYPE];

/* ── Billing ─────────────────────────────────────────────────────────── */

/** invoices.status — varchar(20), default 'unpaid'. */
export const INVOICE_STATUS = {
  /** These three are derived from amounts by lib/money.ts deriveInvoiceStatus. */
  UNPAID: 'unpaid',
  PARTIAL: 'partial',
  PAID: 'paid',
  /** These two are set explicitly and must survive a recompute. */
  WAIVED: 'waived',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

/** invoice_items.itemType — varchar(20), default 'procedure'. */
export const INVOICE_ITEM_TYPE = {
  PROCEDURE: 'procedure',
  PRODUCT: 'product',
  LAB: 'lab',
  ADJUSTMENT: 'adjustment',
  /** A discount line carries a NEGATIVE unitPrice and amount. */
  DISCOUNT: 'discount',
} as const;
export type InvoiceItemType = (typeof INVOICE_ITEM_TYPE)[keyof typeof INVOICE_ITEM_TYPE];

/**
 * payments.type — varchar(20), default 'payment'.
 *
 * CONVENTION: `payments.amount` is ALWAYS a positive integer. Direction lives
 * here, in the type. Never store a negative amount — see PAYMENT_SIGN.
 */
export const PAYMENT_TYPE = {
  PAYMENT: 'payment',
  REFUND: 'refund',
  ADVANCE: 'advance',
  ADJUSTMENT: 'adjustment',
} as const;
export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

/** payments.method — varchar(30), nullable. */
export const PAYMENT_METHOD = {
  CASH: 'cash',
  CARD: 'card',
  BANK_TRANSFER: 'bank_transfer',
  EASYPAISA: 'easypaisa',
  JAZZCASH: 'jazzcash',
  CHEQUE: 'cheque',
  ADJUSTMENT: 'adjustment',
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

/* ── Patients ────────────────────────────────────────────────────────── */

/** patients.status — varchar(20), default 'active'. */
export const PATIENT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
  DECEASED: 'deceased',
} as const;
export type PatientStatus = (typeof PATIENT_STATUS)[keyof typeof PATIENT_STATUS];

/** patients.gender — varchar(10), nullable. */
export const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
} as const;
export type Gender = (typeof GENDER)[keyof typeof GENDER];

/** patients.bloodGroup — varchar(5), nullable. Widest value is 3 chars. */
export const BLOOD_GROUP = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUP)[number];

/** patient_files.fileType — varchar(20), NO DEFAULT. */
export const FILE_TYPE = {
  XRAY: 'xray',
  PHOTO: 'photo',
  DOCUMENT: 'document',
  CONSENT: 'consent',
  REPORT: 'report',
  SCAN: 'scan',
} as const;
export type FileType = (typeof FILE_TYPE)[keyof typeof FILE_TYPE];

/**
 * patient_files.photoStage — varchar(10), nullable.
 * Combined with pairId, this is what pairs before/after photos.
 */
export const PHOTO_STAGE = {
  BEFORE: 'before',
  DURING: 'during',
  AFTER: 'after',
} as const;
export type PhotoStage = (typeof PHOTO_STAGE)[keyof typeof PHOTO_STAGE];

/* ── CRM ─────────────────────────────────────────────────────────────── */

/** leads.status — varchar(20), default 'new'. */
export const LEAD_STATUS = {
  NEW: 'new',
  CONTACTED: 'contacted',
  FOLLOW_UP: 'follow_up',
  QUALIFIED: 'qualified',
  CONVERTED: 'converted',
  LOST: 'lost',
} as const;
export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

/** Statuses that keep a lead in the active funnel. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = [
  LEAD_STATUS.NEW,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.QUALIFIED,
];

/** leads.source — varchar(20), default 'walk_in'. */
export const LEAD_SOURCE = {
  WALK_IN: 'walk_in',
  PHONE: 'phone',
  REFERRAL: 'referral',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  GOOGLE: 'google',
  WEBSITE: 'website',
  OTHER: 'other',
} as const;
export type LeadSource = (typeof LEAD_SOURCE)[keyof typeof LEAD_SOURCE];

/** lead_activities.activityType — varchar(20), NO DEFAULT. */
export const LEAD_ACTIVITY_TYPE = {
  CALL: 'call',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  VISIT: 'visit',
  NOTE: 'note',
} as const;
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPE)[keyof typeof LEAD_ACTIVITY_TYPE];

/** lead_activities.outcome — varchar(20), nullable, no default. */
export const LEAD_ACTIVITY_OUTCOME = {
  CONNECTED: 'connected',
  NO_ANSWER: 'no_answer',
  INTERESTED: 'interested',
  NOT_INTERESTED: 'not_interested',
  CALLBACK: 'callback',
} as const;
export type LeadActivityOutcome =
  (typeof LEAD_ACTIVITY_OUTCOME)[keyof typeof LEAD_ACTIVITY_OUTCOME];

/* ── Communications ──────────────────────────────────────────────────── */

/**
 * communication_logs.channel — varchar(20), NO DEFAULT.
 *
 * Only EMAIL is actually deliverable in phase 1. SMS and WhatsApp exist so
 * staff can LOG a message they sent themselves; no provider is configured and
 * nothing sends them automatically.
 */
export const COMM_CHANNEL = {
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  CALL: 'call',
  IN_PERSON: 'in_person',
} as const;
export type CommChannel = (typeof COMM_CHANNEL)[keyof typeof COMM_CHANNEL];

/** communication_logs.direction — varchar(10), default 'outbound'. */
export const COMM_DIRECTION = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound',
} as const;
export type CommDirection = (typeof COMM_DIRECTION)[keyof typeof COMM_DIRECTION];

/** communication_logs.status — varchar(20), default 'logged'. */
export const COMM_STATUS = {
  /** Default: a message staff recorded manually, with no provider involved. */
  LOGGED: 'logged',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  BOUNCED: 'bounced',
  /** No address on file — turns a dead end into a "call these people" list. */
  SKIPPED: 'skipped',
} as const;
export type CommStatus = (typeof COMM_STATUS)[keyof typeof COMM_STATUS];

/** communication_logs.referenceType — varchar(30), nullable. */
export const COMM_REFERENCE_TYPE = {
  APPOINTMENT: 'appointment',
  INVOICE: 'invoice',
  RECALL: 'recall',
  TREATMENT_PLAN: 'treatment_plan',
  PORTAL: 'portal',
} as const;
export type CommReferenceType = (typeof COMM_REFERENCE_TYPE)[keyof typeof COMM_REFERENCE_TYPE];

/* ── Workflow ────────────────────────────────────────────────────────── */

/** tasks.status — varchar(20), default 'open'. */
export const TASK_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const;
export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

/** tasks.priority — varchar(20), default 'normal'. */
export const TASK_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;
export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

/** task_comments.authorType — varchar(20), default 'admin'. Discriminates authorId. */
export const AUTHOR_TYPE = {
  ADMIN: 'admin',
  PATIENT: 'patient',
} as const;
export type AuthorType = (typeof AUTHOR_TYPE)[keyof typeof AUTHOR_TYPE];

/** notifications.userType — varchar(10), default 'admin'. Added in migration 0002. */
export const NOTIFICATION_USER_TYPE = AUTHOR_TYPE;
export type NotificationUserType = AuthorType;

/* ── Staff & audit ───────────────────────────────────────────────────── */

/** admin_users.staffType — varchar(20), default 'other'. 'owner' is the seeded value. */
export const STAFF_TYPE = {
  OWNER: 'owner',
  DENTIST: 'dentist',
  HYGIENIST: 'hygienist',
  ASSISTANT: 'assistant',
  RECEPTIONIST: 'receptionist',
  MANAGER: 'manager',
  OTHER: 'other',
} as const;
export type StaffType = (typeof STAFF_TYPE)[keyof typeof STAFF_TYPE];

/** Staff who can be booked as the dentist on an appointment. */
export const CLINICAL_STAFF_TYPES: readonly StaffType[] = [
  STAFF_TYPE.OWNER,
  STAFF_TYPE.DENTIST,
  STAFF_TYPE.HYGIENIST,
];

/** audit_logs.action — varchar(20), NO DEFAULT. */
export const AUDIT_ACTION = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  /** Recorded for chart opens, file downloads and prescription views. */
  VIEW: 'view',
  LOGIN: 'login',
  EXPORT: 'export',
} as const;
export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

/** audit_logs.entityType — varchar(30), NO DEFAULT. Discriminates entityId. */
export const AUDIT_ENTITY = {
  PATIENT: 'patient',
  VISIT: 'visit',
  VISIT_PROCEDURE: 'visit_procedure',
  VISIT_DIAGNOSIS: 'visit_diagnosis',
  TOOTH_CONDITION: 'tooth_condition',
  PATIENT_CONDITION: 'patient_condition',
  PATIENT_FILE: 'patient_file',
  PRESCRIPTION: 'prescription',
  TREATMENT_PLAN: 'treatment_plan',
  TREATMENT_PLAN_ITEM: 'treatment_plan_item',
  APPOINTMENT: 'appointment',
  RECALL: 'recall',
  INVOICE: 'invoice',
  INVOICE_ITEM: 'invoice_item',
  PAYMENT: 'payment',
  LEAD: 'lead',
  ADMIN_USER: 'admin_user',
  ADMIN_ROLE: 'admin_role',
  CLINIC_SETTINGS: 'clinic_settings',
  MESSAGE_TEMPLATE: 'message_template',
  BRANCH: 'branch',
  PROCEDURE: 'procedure',
  CLINIC: 'clinic',
} as const;
export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Values of an `as const` vocabulary, for building <select> options. */
export function valuesOf<T extends Record<string, string>>(vocab: T): T[keyof T][] {
  return Object.values(vocab) as T[keyof T][];
}

/** Type guard for validating an untrusted string against a vocabulary. */
export function isValidValue<T extends Record<string, string>>(
  vocab: T,
  value: unknown
): value is T[keyof T] {
  return typeof value === 'string' && (Object.values(vocab) as string[]).includes(value);
}

/** 'follow_up' -> 'Follow up'. For labels, so the UI needn't hardcode them. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
