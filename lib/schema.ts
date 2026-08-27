// AUTO-GENERATED from the live MySQL database.
// Source: dental @ db-mysql-nyc3-97674-do-user-23353122-0.i.db.ondigitalocean.com  (36 tables)
// Regenerate rather than hand-editing where possible.

import { relations, sql } from 'drizzle-orm';
import {
  mysqlTable,
  varchar,
  text,
  int,
  boolean,
  json,
  datetime,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/mysql-core';

// ── account ───────────────────────────────────────────
export const account = mysqlTable(
  'account',
  {
    userId: varchar('userId', { length: 255 }).notNull(),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('providerAccountId', { length: 255 }).notNull(),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    expiresAt: datetime('expires_at'),
    tokenType: varchar('token_type', { length: 255 }),
    scope: varchar('scope', { length: 255 }),
    idToken: text('id_token'),
    sessionState: varchar('session_state', { length: 255 }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
  })
);

// ── admin_roles ───────────────────────────────────────
export const adminRoles = mysqlTable('admin_roles', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  permissions: text('permissions').notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── admin_users ───────────────────────────────────────
export const adminUsers = mysqlTable(
  'admin_users',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    password: varchar('password', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    roleId: varchar('roleId', { length: 255 }).notNull(),
    createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
    branchId: varchar('branchId', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    staffType: varchar('staffType', { length: 20 }).default('other'),
    licenseNumber: varchar('licenseNumber', { length: 50 }),
    signatureUrl: varchar('signatureUrl', { length: 500 }),
    isActive: boolean('isActive').default(true),
  },
  (table) => ({
    adminUsersEmailUnique: uniqueIndex('admin_users_email_unique').on(table.email),
  })
);

// ── appointments ──────────────────────────────────────
export const appointments = mysqlTable('appointments', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  dentistId: varchar('dentistId', { length: 255 }).notNull(),
  chairId: varchar('chairId', { length: 255 }),
  startAt: datetime('startAt').notNull(),
  endAt: datetime('endAt').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('procedure'),
  status: varchar('status', { length: 20 }).notNull().default('scheduled'),
  isWalkIn: boolean('isWalkIn').default(false),
  treatmentPlanItemId: varchar('treatmentPlanItemId', { length: 255 }),
  recallId: varchar('recallId', { length: 255 }),
  reasonNote: varchar('reasonNote', { length: 500 }),
  cancellationReason: varchar('cancellationReason', { length: 255 }),
  cancelledBy: varchar('cancelledBy', { length: 255 }),
  cancelledAt: datetime('cancelledAt'),
  confirmedAt: datetime('confirmedAt'),
  checkedInAt: datetime('checkedInAt'),
  completedAt: datetime('completedAt'),
  reminderEmailSentAt: datetime('reminderEmailSentAt'),
  createdBy: varchar('createdBy', { length: 255 }).notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── audit_logs ────────────────────────────────────────
export const auditLogs = mysqlTable('audit_logs', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  actorId: varchar('actorId', { length: 255 }).notNull(),
  actorEmail: varchar('actorEmail', { length: 255 }),
  action: varchar('action', { length: 20 }).notNull(),
  entityType: varchar('entityType', { length: 30 }).notNull(),
  entityId: varchar('entityId', { length: 255 }),
  patientId: varchar('patientId', { length: 255 }),
  before: json('before'),
  after: json('after'),
  ipAddress: varchar('ipAddress', { length: 45 }),
  userAgent: varchar('userAgent', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── branches ──────────────────────────────────────────
export const branches = mysqlTable(
  'branches',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 10 }).notNull(),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    phone: varchar('phone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    timezone: varchar('timezone', { length: 50 }).default('Asia/Karachi'),
    isActive: boolean('isActive').default(true),
    createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    branchesCodeUnique: uniqueIndex('branches_code_unique').on(table.code),
  })
);

// ── chairs ────────────────────────────────────────────
export const chairs = mysqlTable('chairs', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  isActive: boolean('isActive').default(true),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── clinic_settings ───────────────────────────────────
export const clinicSettings = mysqlTable('clinic_settings', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  clinicName: varchar('clinicName', { length: 255 }).notNull().default('Dental Clinic'),
  address: text('address'),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  logoUrl: varchar('logoUrl', { length: 500 }),
  workStartTime: varchar('workStartTime', { length: 5 }).default('09:00'),
  workEndTime: varchar('workEndTime', { length: 5 }).default('21:00'),
  slotMinutes: int('slotMinutes').default(15),
  currency: varchar('currency', { length: 5 }).default('PKR'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── communication_logs ────────────────────────────────
export const communicationLogs = mysqlTable('communication_logs', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }),
  leadId: varchar('leadId', { length: 255 }),
  channel: varchar('channel', { length: 20 }).notNull(),
  direction: varchar('direction', { length: 10 }).notNull().default('outbound'),
  subject: varchar('subject', { length: 255 }),
  body: text('body'),
  status: varchar('status', { length: 20 }).notNull().default('logged'),
  referenceType: varchar('referenceType', { length: 30 }),
  referenceId: varchar('referenceId', { length: 255 }),
  performedBy: varchar('performedBy', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── invoice_items ─────────────────────────────────────
export const invoiceItems = mysqlTable('invoice_items', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  invoiceId: varchar('invoiceId', { length: 255 }).notNull(),
  procedureId: varchar('procedureId', { length: 255 }),
  visitProcedureId: varchar('visitProcedureId', { length: 255 }),
  treatmentPlanItemId: varchar('treatmentPlanItemId', { length: 255 }),
  description: varchar('description', { length: 255 }).notNull(),
  teeth: varchar('teeth', { length: 100 }),
  quantity: int('quantity').default(1),
  unitPrice: int('unitPrice').notNull(),
  discountAmount: int('discountAmount').default(0),
  amount: int('amount').notNull(),
  itemType: varchar('itemType', { length: 20 }).notNull().default('procedure'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── invoices ──────────────────────────────────────────
export const invoices = mysqlTable(
  'invoices',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    invoiceNumber: varchar('invoiceNumber', { length: 30 }).notNull(),
    patientId: varchar('patientId', { length: 255 }).notNull(),
    branchId: varchar('branchId', { length: 255 }).notNull(),
    visitId: varchar('visitId', { length: 255 }),
    treatmentPlanId: varchar('treatmentPlanId', { length: 255 }),
    issueDate: datetime('issueDate').default(sql`CURRENT_TIMESTAMP`),
    dueDate: datetime('dueDate'),
    subtotal: int('subtotal').notNull(),
    discountTotal: int('discountTotal').default(0),
    totalAmount: int('totalAmount').notNull(),
    paidAmount: int('paidAmount').default(0),
    status: varchar('status', { length: 20 }).notNull().default('unpaid'),
    notes: text('notes'),
    createdBy: varchar('createdBy', { length: 255 }).notNull(),
    createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    invoicesInvoiceNumberUnique: uniqueIndex('invoices_invoiceNumber_unique').on(table.invoiceNumber),
  })
);

// ── lead_activities ───────────────────────────────────
export const leadActivities = mysqlTable('lead_activities', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  leadId: varchar('leadId', { length: 255 }).notNull(),
  activityType: varchar('activityType', { length: 20 }).notNull(),
  note: text('note'),
  outcome: varchar('outcome', { length: 20 }),
  performedBy: varchar('performedBy', { length: 255 }).notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── leads ─────────────────────────────────────────────
export const leads = mysqlTable('leads', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }).notNull(),
  email: varchar('email', { length: 255 }),
  source: varchar('source', { length: 20 }).notNull().default('walk_in'),
  interestedProcedureId: varchar('interestedProcedureId', { length: 255 }),
  interestNote: varchar('interestNote', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  lostReason: varchar('lostReason', { length: 255 }),
  assignedTo: varchar('assignedTo', { length: 255 }),
  nextFollowUpAt: datetime('nextFollowUpAt'),
  convertedPatientId: varchar('convertedPatientId', { length: 255 }),
  convertedAt: datetime('convertedAt'),
  createdBy: varchar('createdBy', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── login_attempts ────────────────────────────────────
export const loginAttempts = mysqlTable('login_attempts', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  ipAddress: varchar('ipAddress', { length: 45 }),
  success: boolean('success').default(false),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── notifications ─────────────────────────────────────
export const notifications = mysqlTable('notifications', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  userId: varchar('userId', { length: 255 }).notNull(),
  type: varchar('type', { length: 30 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message'),
  link: varchar('link', { length: 500 }),
  imageUrl: varchar('imageUrl', { length: 500 }),
  referenceId: varchar('referenceId', { length: 255 }),
  isRead: boolean('isRead').default(false),
  readAt: datetime('readAt'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── patient_conditions ────────────────────────────────
export const patientConditions = mysqlTable('patient_conditions', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  conditionType: varchar('conditionType', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  severity: varchar('severity', { length: 20 }),
  isAlert: boolean('isAlert').default(false),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  recordedBy: varchar('recordedBy', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── patient_files ─────────────────────────────────────
export const patientFiles = mysqlTable('patient_files', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  visitId: varchar('visitId', { length: 255 }),
  toothNumber: varchar('toothNumber', { length: 2 }),
  fileType: varchar('fileType', { length: 20 }).notNull(),
  photoStage: varchar('photoStage', { length: 10 }),
  pairId: varchar('pairId', { length: 255 }),
  title: varchar('title', { length: 255 }),
  storageKey: varchar('storageKey', { length: 500 }).notNull(),
  mimeType: varchar('mimeType', { length: 100 }).notNull(),
  sizeBytes: int('sizeBytes'),
  uploadedBy: varchar('uploadedBy', { length: 255 }).notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── patients ──────────────────────────────────────────
export const patients = mysqlTable(
  'patients',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    mrn: varchar('mrn', { length: 20 }).notNull(),
    branchId: varchar('branchId', { length: 255 }).notNull(),
    firstName: varchar('firstName', { length: 100 }).notNull(),
    lastName: varchar('lastName', { length: 100 }),
    gender: varchar('gender', { length: 10 }),
    dateOfBirth: datetime('dateOfBirth'),
    cnic: varchar('cnic', { length: 15 }),
    phone: varchar('phone', { length: 20 }).notNull(),
    altPhone: varchar('altPhone', { length: 20 }),
    email: varchar('email', { length: 255 }),
    address: text('address'),
    city: varchar('city', { length: 100 }),
    emergencyContactName: varchar('emergencyContactName', { length: 255 }),
    emergencyContactPhone: varchar('emergencyContactPhone', { length: 20 }),
    emergencyContactRelation: varchar('emergencyContactRelation', { length: 50 }),
    guardianName: varchar('guardianName', { length: 255 }),
    bloodGroup: varchar('bloodGroup', { length: 5 }),
    occupation: varchar('occupation', { length: 100 }),
    referredBy: varchar('referredBy', { length: 255 }),
    leadId: varchar('leadId', { length: 255 }),
    defaultDiscountPercent: int('defaultDiscountPercent').default(0),
    medicalNotes: text('medicalNotes'),
    dentalNotes: text('dentalNotes'),
    hasAlerts: boolean('hasAlerts').default(false),
    portalUserId: varchar('portalUserId', { length: 255 }),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    registeredBy: varchar('registeredBy', { length: 255 }),
    createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    patientsMrnUnique: uniqueIndex('patients_mrn_unique').on(table.mrn),
  })
);

// ── payments ──────────────────────────────────────────
export const payments = mysqlTable('payments', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  invoiceId: varchar('invoiceId', { length: 255 }),
  amount: int('amount').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('payment'),
  method: varchar('method', { length: 30 }),
  transactionId: varchar('transactionId', { length: 255 }),
  paymentDate: datetime('paymentDate').default(sql`CURRENT_TIMESTAMP`),
  notes: text('notes'),
  recordedBy: varchar('recordedBy', { length: 255 }).notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── prescription_items ────────────────────────────────
export const prescriptionItems = mysqlTable('prescription_items', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  prescriptionId: varchar('prescriptionId', { length: 255 }).notNull(),
  drugName: varchar('drugName', { length: 255 }).notNull(),
  dosage: varchar('dosage', { length: 100 }),
  frequency: varchar('frequency', { length: 100 }),
  durationDays: int('durationDays'),
  instructions: varchar('instructions', { length: 255 }),
  sortOrder: int('sortOrder').default(0),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── prescriptions ─────────────────────────────────────
export const prescriptions = mysqlTable('prescriptions', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  visitId: varchar('visitId', { length: 255 }).notNull(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  dentistId: varchar('dentistId', { length: 255 }).notNull(),
  notes: text('notes'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── procedures ────────────────────────────────────────
export const procedures = mysqlTable(
  'procedures',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    code: varchar('code', { length: 20 }),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 30 }).notNull(),
    defaultPrice: int('defaultPrice').notNull(),
    durationMinutes: int('durationMinutes').default(30),
    isPerTooth: boolean('isPerTooth').default(true),
    defaultRecallMonths: int('defaultRecallMonths'),
    isActive: boolean('isActive').default(true),
    createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    proceduresCodeUnique: uniqueIndex('procedures_code_unique').on(table.code),
  })
);

// ── recalls ───────────────────────────────────────────
export const recalls = mysqlTable('recalls', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  recallType: varchar('recallType', { length: 30 }).notNull(),
  dueDate: datetime('dueDate').notNull(),
  intervalMonths: int('intervalMonths'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  appointmentId: varchar('appointmentId', { length: 255 }),
  sourceVisitId: varchar('sourceVisitId', { length: 255 }),
  notes: varchar('notes', { length: 500 }),
  createdBy: varchar('createdBy', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── sessions ──────────────────────────────────────────
export const sessions = mysqlTable('sessions', {
  sessionToken: varchar('sessionToken', { length: 255 }).notNull().primaryKey(),
  userId: varchar('userId', { length: 255 }).notNull(),
  expires: datetime('expires').notNull(),
});

// ── staff_schedules ───────────────────────────────────
export const staffSchedules = mysqlTable('staff_schedules', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  staffId: varchar('staffId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  dayOfWeek: int('dayOfWeek').notNull(),
  startTime: varchar('startTime', { length: 5 }).notNull(),
  endTime: varchar('endTime', { length: 5 }).notNull(),
  isActive: boolean('isActive').default(true),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── staff_time_off ────────────────────────────────────
export const staffTimeOff = mysqlTable('staff_time_off', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  staffId: varchar('staffId', { length: 255 }).notNull(),
  startDate: datetime('startDate').notNull(),
  endDate: datetime('endDate').notNull(),
  reason: varchar('reason', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── task_comments ─────────────────────────────────────
export const taskComments = mysqlTable('task_comments', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  taskId: varchar('taskId', { length: 255 }).notNull(),
  authorId: varchar('authorId', { length: 255 }).notNull(),
  authorType: varchar('authorType', { length: 20 }).notNull().default('admin'),
  authorName: varchar('authorName', { length: 255 }),
  comment: text('comment').notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── tasks ─────────────────────────────────────────────
export const tasks = mysqlTable('tasks', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  patientId: varchar('patientId', { length: 255 }),
  leadId: varchar('leadId', { length: 255 }),
  branchId: varchar('branchId', { length: 255 }),
  assignedTo: varchar('assignedTo', { length: 255 }),
  dueDate: datetime('dueDate'),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  priority: varchar('priority', { length: 20 }).default('normal'),
  createdBy: varchar('createdBy', { length: 255 }),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── tooth_conditions ──────────────────────────────────
export const toothConditions = mysqlTable('tooth_conditions', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  toothNumber: varchar('toothNumber', { length: 2 }).notNull(),
  surfaces: varchar('surfaces', { length: 10 }),
  conditionType: varchar('conditionType', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  notes: text('notes'),
  visitId: varchar('visitId', { length: 255 }),
  diagnosisId: varchar('diagnosisId', { length: 255 }),
  treatmentPlanItemId: varchar('treatmentPlanItemId', { length: 255 }),
  resolvedByVisitId: varchar('resolvedByVisitId', { length: 255 }),
  resolvedAt: datetime('resolvedAt'),
  recordedBy: varchar('recordedBy', { length: 255 }).notNull(),
  recordedAt: datetime('recordedAt').default(sql`CURRENT_TIMESTAMP`),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── treatment_plan_items ──────────────────────────────
export const treatmentPlanItems = mysqlTable('treatment_plan_items', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  treatmentPlanId: varchar('treatmentPlanId', { length: 255 }).notNull(),
  procedureId: varchar('procedureId', { length: 255 }).notNull(),
  teeth: varchar('teeth', { length: 100 }),
  surfaces: varchar('surfaces', { length: 10 }),
  toothConditionId: varchar('toothConditionId', { length: 255 }),
  unitPrice: int('unitPrice').notNull(),
  quantity: int('quantity').default(1),
  discountType: varchar('discountType', { length: 20 }),
  discountValue: int('discountValue').default(0),
  netAmount: int('netAmount').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  appointmentId: varchar('appointmentId', { length: 255 }),
  visitProcedureId: varchar('visitProcedureId', { length: 255 }),
  sortOrder: int('sortOrder').default(0),
  notes: text('notes'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── treatment_plans ───────────────────────────────────
export const treatmentPlans = mysqlTable('treatment_plans', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  dentistId: varchar('dentistId', { length: 255 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  totalAmount: int('totalAmount').default(0),
  discountTotal: int('discountTotal').default(0),
  netAmount: int('netAmount').default(0),
  proposedAt: datetime('proposedAt'),
  acceptedAt: datetime('acceptedAt'),
  acceptedNote: varchar('acceptedNote', { length: 255 }),
  consentFileId: varchar('consentFileId', { length: 255 }),
  cancelReason: varchar('cancelReason', { length: 255 }),
  notes: text('notes'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── user ──────────────────────────────────────────────
export const user = mysqlTable(
  'user',
  {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 255 }),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    email: varchar('email', { length: 255 }).notNull(),
    emailVerified: datetime('emailVerified'),
    image: text('image'),
    profilePicture: varchar('profile_picture', { length: 255 }),
    username: varchar('username', { length: 100 }),
    displayName: varchar('display_name', { length: 100 }),
    country: varchar('country', { length: 100 }),
    city: varchar('city', { length: 100 }),
    address: varchar('address', { length: 100 }),
    state: varchar('state', { length: 100 }),
    phone: varchar('phone', { length: 20 }),
    otp: varchar('otp', { length: 6 }),
    otpExpiry: datetime('otp_expiry'),
    createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userEmailUnique: uniqueIndex('user_email_unique').on(table.email),
  })
);

// ── verification_tokens ───────────────────────────────
export const verificationTokens = mysqlTable(
  'verification_tokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    otp: varchar('otp', { length: 255 }).notNull(),
    expires: datetime('expires').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token, table.otp] }),
  })
);

// ── visit_diagnoses ───────────────────────────────────
export const visitDiagnoses = mysqlTable('visit_diagnoses', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  visitId: varchar('visitId', { length: 255 }).notNull(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  toothNumber: varchar('toothNumber', { length: 2 }),
  code: varchar('code', { length: 20 }),
  description: varchar('description', { length: 500 }).notNull(),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── visit_procedures ──────────────────────────────────
export const visitProcedures = mysqlTable('visit_procedures', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  visitId: varchar('visitId', { length: 255 }).notNull(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  procedureId: varchar('procedureId', { length: 255 }).notNull(),
  treatmentPlanItemId: varchar('treatmentPlanItemId', { length: 255 }),
  teeth: varchar('teeth', { length: 100 }),
  surfaces: varchar('surfaces', { length: 10 }),
  performedBy: varchar('performedBy', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  price: int('price').notNull(),
  notes: text('notes'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
});

// ── visits ────────────────────────────────────────────
export const visits = mysqlTable('visits', {
  id: varchar('id', { length: 255 }).notNull().primaryKey(),
  patientId: varchar('patientId', { length: 255 }).notNull(),
  branchId: varchar('branchId', { length: 255 }).notNull(),
  appointmentId: varchar('appointmentId', { length: 255 }),
  dentistId: varchar('dentistId', { length: 255 }).notNull(),
  visitDate: datetime('visitDate').notNull(),
  chiefComplaint: text('chiefComplaint'),
  examinationNotes: text('examinationNotes'),
  treatmentNotes: text('treatmentNotes'),
  bloodPressure: varchar('bloodPressure', { length: 10 }),
  followUpInstructions: text('followUpInstructions'),
  status: varchar('status', { length: 20 }).notNull().default('in_progress'),
  createdAt: datetime('createdAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updatedAt').default(sql`CURRENT_TIMESTAMP`),
});
