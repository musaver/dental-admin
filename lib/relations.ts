import { relations } from 'drizzle-orm';
import {
  account,
  adminRoles,
  adminUsers,
  appointments,
  auditLogs,
  branches,
  chairs,
  communicationLogs,
  invoiceItems,
  invoices,
  leadActivities,
  leads,
  messageTemplates,
  notifications,
  patientConditions,
  patientFiles,
  patients,
  payments,
  prescriptionItems,
  prescriptions,
  procedures,
  recalls,
  sessions,
  staffSchedules,
  staffTimeOff,
  taskComments,
  tasks,
  toothConditions,
  treatmentPlanItems,
  treatmentPlans,
  user,
  userPreferences,
  visitDiagnoses,
  visitProcedures,
  visits,
} from './schema';

/**
 * Relational metadata for the dental schema.
 *
 * Kept OUT of lib/schema.ts because that file is generated from the live
 * database; regenerating it would wipe anything hand-written here.
 *
 * The database defines ZERO foreign keys — every relationship below is a
 * naming convention (`patientId`, `visitId`, `dentistId`, …) that nothing at
 * the storage layer enforces. These blocks give Drizzle's relational query API
 * (`db.query.x.findMany({ with: … })`) something to work with, but they do not
 * add referential integrity: a dangling id is still possible and still your
 * problem to detect.
 *
 * Where two tables are joined by more than one column, both sides carry a
 * matching `relationName` — without it Drizzle cannot tell which `one` pairs
 * with which `many`.
 *
 * Deliberately NOT modelled (opaque or polymorphic, not foreign keys):
 *   auditLogs.entityId          – polymorphic, discriminated by entityType
 *   communicationLogs.reference* – polymorphic, discriminated by referenceType
 *   notifications.referenceId   – polymorphic, discriminated by type
 *   patientFiles.pairId         – groups before/after photos, not a row pointer
 *   payments.transactionId      – external gateway reference
 *   patients.referredBy         – free text or an admin id; ambiguous by design
 *   account.providerAccountId   – part of the composite primary key
 */

/* ── Org ─────────────────────────────────────────────────────────────── */

export const branchesRelations = relations(branches, ({ many }) => ({
  adminUsers: many(adminUsers),
  chairs: many(chairs),
  patients: many(patients),
  appointments: many(appointments),
  visits: many(visits),
  invoices: many(invoices),
  payments: many(payments),
  leads: many(leads),
  recalls: many(recalls),
  treatmentPlans: many(treatmentPlans),
  staffSchedules: many(staffSchedules),
  tasks: many(tasks),
}));

export const chairsRelations = relations(chairs, ({ one, many }) => ({
  branch: one(branches, { fields: [chairs.branchId], references: [branches.id] }),
  appointments: many(appointments),
}));

/* ── Staff & access ──────────────────────────────────────────────────── */

export const adminRolesRelations = relations(adminRoles, ({ many }) => ({
  adminUsers: many(adminUsers),
}));

export const adminUsersRelations = relations(adminUsers, ({ one, many }) => ({
  role: one(adminRoles, { fields: [adminUsers.roleId], references: [adminRoles.id] }),
  branch: one(branches, { fields: [adminUsers.branchId], references: [branches.id] }),
  schedules: many(staffSchedules),
  timeOff: many(staffTimeOff),
  appointmentsAsDentist: many(appointments, { relationName: 'appointmentDentist' }),
  visitsAsDentist: many(visits, { relationName: 'visitDentist' }),
  treatmentPlansAsDentist: many(treatmentPlans, { relationName: 'planDentist' }),
  prescriptions: many(prescriptions),
  assignedTasks: many(tasks, { relationName: 'taskAssignee' }),
  assignedLeads: many(leads, { relationName: 'leadAssignee' }),
  auditEntries: many(auditLogs),
}));

export const staffSchedulesRelations = relations(staffSchedules, ({ one }) => ({
  staff: one(adminUsers, { fields: [staffSchedules.staffId], references: [adminUsers.id] }),
  branch: one(branches, { fields: [staffSchedules.branchId], references: [branches.id] }),
}));

export const staffTimeOffRelations = relations(staffTimeOff, ({ one }) => ({
  staff: one(adminUsers, { fields: [staffTimeOff.staffId], references: [adminUsers.id] }),
}));

/* ── Portal auth (NextAuth shape) ────────────────────────────────────── */

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(sessions),
  patients: many(patients),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(user, { fields: [sessions.userId], references: [user.id] }),
}));

/* ── Patients ────────────────────────────────────────────────────────── */

export const patientsRelations = relations(patients, ({ one, many }) => ({
  branch: one(branches, { fields: [patients.branchId], references: [branches.id] }),
  registeredByStaff: one(adminUsers, {
    fields: [patients.registeredBy],
    references: [adminUsers.id],
  }),
  portalUser: one(user, { fields: [patients.portalUserId], references: [user.id] }),
  // Paired with leads.convertedPatient — the two-pointer conversion link.
  lead: one(leads, {
    fields: [patients.leadId],
    references: [leads.id],
    relationName: 'patientOriginLead',
  }),
  conditions: many(patientConditions),
  toothConditions: many(toothConditions),
  files: many(patientFiles),
  appointments: many(appointments),
  visits: many(visits),
  treatmentPlans: many(treatmentPlans),
  prescriptions: many(prescriptions),
  invoices: many(invoices),
  payments: many(payments),
  recalls: many(recalls),
  communications: many(communicationLogs),
  tasks: many(tasks),
  visitDiagnoses: many(visitDiagnoses),
  visitProcedures: many(visitProcedures),
}));

export const patientConditionsRelations = relations(patientConditions, ({ one }) => ({
  patient: one(patients, { fields: [patientConditions.patientId], references: [patients.id] }),
  recordedByStaff: one(adminUsers, {
    fields: [patientConditions.recordedBy],
    references: [adminUsers.id],
  }),
}));

export const patientFilesRelations = relations(patientFiles, ({ one }) => ({
  patient: one(patients, { fields: [patientFiles.patientId], references: [patients.id] }),
  visit: one(visits, { fields: [patientFiles.visitId], references: [visits.id] }),
  uploadedByStaff: one(adminUsers, {
    fields: [patientFiles.uploadedBy],
    references: [adminUsers.id],
  }),
}));

/* ── Odontogram ──────────────────────────────────────────────────────── */

export const toothConditionsRelations = relations(toothConditions, ({ one }) => ({
  patient: one(patients, { fields: [toothConditions.patientId], references: [patients.id] }),
  // Two distinct links to `visits`: where it was charted, and where it was closed out.
  visit: one(visits, {
    fields: [toothConditions.visitId],
    references: [visits.id],
    relationName: 'toothChartedAtVisit',
  }),
  resolvedByVisit: one(visits, {
    fields: [toothConditions.resolvedByVisitId],
    references: [visits.id],
    relationName: 'toothResolvedAtVisit',
  }),
  diagnosis: one(visitDiagnoses, {
    fields: [toothConditions.diagnosisId],
    references: [visitDiagnoses.id],
  }),
  treatmentPlanItem: one(treatmentPlanItems, {
    fields: [toothConditions.treatmentPlanItemId],
    references: [treatmentPlanItems.id],
    relationName: 'toothPlannedAs',
  }),
  recordedByStaff: one(adminUsers, {
    fields: [toothConditions.recordedBy],
    references: [adminUsers.id],
  }),
}));

/* ── Scheduling ──────────────────────────────────────────────────────── */

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  patient: one(patients, { fields: [appointments.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [appointments.branchId], references: [branches.id] }),
  chair: one(chairs, { fields: [appointments.chairId], references: [chairs.id] }),
  dentist: one(adminUsers, {
    fields: [appointments.dentistId],
    references: [adminUsers.id],
    relationName: 'appointmentDentist',
  }),
  createdByStaff: one(adminUsers, {
    fields: [appointments.createdBy],
    references: [adminUsers.id],
    relationName: 'appointmentCreator',
  }),
  cancelledByStaff: one(adminUsers, {
    fields: [appointments.cancelledBy],
    references: [adminUsers.id],
    relationName: 'appointmentCanceller',
  }),
  // Bidirectional: treatment_plan_items.appointmentId points back here.
  treatmentPlanItem: one(treatmentPlanItems, {
    fields: [appointments.treatmentPlanItemId],
    references: [treatmentPlanItems.id],
    relationName: 'appointmentForPlanItem',
  }),
  // Bidirectional: recalls.appointmentId points back here.
  recall: one(recalls, {
    fields: [appointments.recallId],
    references: [recalls.id],
    relationName: 'appointmentFromRecall',
  }),
  visits: many(visits),
}));

export const recallsRelations = relations(recalls, ({ one }) => ({
  patient: one(patients, { fields: [recalls.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [recalls.branchId], references: [branches.id] }),
  appointment: one(appointments, {
    fields: [recalls.appointmentId],
    references: [appointments.id],
    relationName: 'recallBookedAs',
  }),
  sourceVisit: one(visits, { fields: [recalls.sourceVisitId], references: [visits.id] }),
  createdByStaff: one(adminUsers, {
    fields: [recalls.createdBy],
    references: [adminUsers.id],
  }),
}));

/* ── Clinical ────────────────────────────────────────────────────────── */

export const visitsRelations = relations(visits, ({ one, many }) => ({
  patient: one(patients, { fields: [visits.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [visits.branchId], references: [branches.id] }),
  appointment: one(appointments, {
    fields: [visits.appointmentId],
    references: [appointments.id],
  }),
  dentist: one(adminUsers, {
    fields: [visits.dentistId],
    references: [adminUsers.id],
    relationName: 'visitDentist',
  }),
  procedures: many(visitProcedures),
  diagnoses: many(visitDiagnoses),
  prescriptions: many(prescriptions),
  files: many(patientFiles),
  invoices: many(invoices),
  chartedToothConditions: many(toothConditions, { relationName: 'toothChartedAtVisit' }),
  resolvedToothConditions: many(toothConditions, { relationName: 'toothResolvedAtVisit' }),
}));

export const visitProceduresRelations = relations(visitProcedures, ({ one, many }) => ({
  visit: one(visits, { fields: [visitProcedures.visitId], references: [visits.id] }),
  patient: one(patients, { fields: [visitProcedures.patientId], references: [patients.id] }),
  procedure: one(procedures, {
    fields: [visitProcedures.procedureId],
    references: [procedures.id],
  }),
  // Bidirectional: treatment_plan_items.visitProcedureId points back here.
  treatmentPlanItem: one(treatmentPlanItems, {
    fields: [visitProcedures.treatmentPlanItemId],
    references: [treatmentPlanItems.id],
    relationName: 'visitProcedureDeliversPlanItem',
  }),
  performedByStaff: one(adminUsers, {
    fields: [visitProcedures.performedBy],
    references: [adminUsers.id],
  }),
  invoiceItems: many(invoiceItems),
}));

export const visitDiagnosesRelations = relations(visitDiagnoses, ({ one, many }) => ({
  visit: one(visits, { fields: [visitDiagnoses.visitId], references: [visits.id] }),
  patient: one(patients, { fields: [visitDiagnoses.patientId], references: [patients.id] }),
  toothConditions: many(toothConditions),
}));

export const prescriptionsRelations = relations(prescriptions, ({ one, many }) => ({
  // visitId is NOT NULL: a prescription cannot exist outside a visit.
  visit: one(visits, { fields: [prescriptions.visitId], references: [visits.id] }),
  patient: one(patients, { fields: [prescriptions.patientId], references: [patients.id] }),
  dentist: one(adminUsers, {
    fields: [prescriptions.dentistId],
    references: [adminUsers.id],
  }),
  items: many(prescriptionItems),
}));

export const prescriptionItemsRelations = relations(prescriptionItems, ({ one }) => ({
  prescription: one(prescriptions, {
    fields: [prescriptionItems.prescriptionId],
    references: [prescriptions.id],
  }),
}));

/* ── Treatment planning ──────────────────────────────────────────────── */

export const proceduresRelations = relations(procedures, ({ many }) => ({
  treatmentPlanItems: many(treatmentPlanItems),
  visitProcedures: many(visitProcedures),
  invoiceItems: many(invoiceItems),
  interestedLeads: many(leads),
}));

export const treatmentPlansRelations = relations(treatmentPlans, ({ one, many }) => ({
  patient: one(patients, { fields: [treatmentPlans.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [treatmentPlans.branchId], references: [branches.id] }),
  dentist: one(adminUsers, {
    fields: [treatmentPlans.dentistId],
    references: [adminUsers.id],
    relationName: 'planDentist',
  }),
  consentFile: one(patientFiles, {
    fields: [treatmentPlans.consentFileId],
    references: [patientFiles.id],
  }),
  items: many(treatmentPlanItems),
  invoices: many(invoices),
}));

export const treatmentPlanItemsRelations = relations(treatmentPlanItems, ({ one, many }) => ({
  treatmentPlan: one(treatmentPlans, {
    fields: [treatmentPlanItems.treatmentPlanId],
    references: [treatmentPlans.id],
  }),
  procedure: one(procedures, {
    fields: [treatmentPlanItems.procedureId],
    references: [procedures.id],
  }),
  toothCondition: one(toothConditions, {
    fields: [treatmentPlanItems.toothConditionId],
    references: [toothConditions.id],
    relationName: 'planItemForTooth',
  }),
  // Bidirectional: appointments.treatmentPlanItemId points back here.
  appointment: one(appointments, {
    fields: [treatmentPlanItems.appointmentId],
    references: [appointments.id],
    relationName: 'planItemScheduledAs',
  }),
  // Bidirectional: visit_procedures.treatmentPlanItemId points back here.
  visitProcedure: one(visitProcedures, {
    fields: [treatmentPlanItems.visitProcedureId],
    references: [visitProcedures.id],
    relationName: 'planItemDeliveredAs',
  }),
  invoiceItems: many(invoiceItems),
}));

/* ── Billing ─────────────────────────────────────────────────────────── */

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  patient: one(patients, { fields: [invoices.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [invoices.branchId], references: [branches.id] }),
  visit: one(visits, { fields: [invoices.visitId], references: [visits.id] }),
  treatmentPlan: one(treatmentPlans, {
    fields: [invoices.treatmentPlanId],
    references: [treatmentPlans.id],
  }),
  createdByStaff: one(adminUsers, {
    fields: [invoices.createdBy],
    references: [adminUsers.id],
  }),
  items: many(invoiceItems),
  payments: many(payments),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
  procedure: one(procedures, {
    fields: [invoiceItems.procedureId],
    references: [procedures.id],
  }),
  visitProcedure: one(visitProcedures, {
    fields: [invoiceItems.visitProcedureId],
    references: [visitProcedures.id],
  }),
  treatmentPlanItem: one(treatmentPlanItems, {
    fields: [invoiceItems.treatmentPlanItemId],
    references: [treatmentPlanItems.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  patient: one(patients, { fields: [payments.patientId], references: [patients.id] }),
  branch: one(branches, { fields: [payments.branchId], references: [branches.id] }),
  // Nullable: an unallocated payment is a deposit / credit on account.
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
  recordedByStaff: one(adminUsers, {
    fields: [payments.recordedBy],
    references: [adminUsers.id],
  }),
}));

/* ── CRM ─────────────────────────────────────────────────────────────── */

export const leadsRelations = relations(leads, ({ one, many }) => ({
  branch: one(branches, { fields: [leads.branchId], references: [branches.id] }),
  interestedProcedure: one(procedures, {
    fields: [leads.interestedProcedureId],
    references: [procedures.id],
  }),
  assignedToStaff: one(adminUsers, {
    fields: [leads.assignedTo],
    references: [adminUsers.id],
    relationName: 'leadAssignee',
  }),
  createdByStaff: one(adminUsers, {
    fields: [leads.createdBy],
    references: [adminUsers.id],
    relationName: 'leadCreator',
  }),
  // Paired with patients.lead — the two-pointer conversion link.
  convertedPatient: one(patients, {
    fields: [leads.convertedPatientId],
    references: [patients.id],
    relationName: 'leadConvertedPatient',
  }),
  activities: many(leadActivities),
  communications: many(communicationLogs),
  tasks: many(tasks),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, { fields: [leadActivities.leadId], references: [leads.id] }),
  performedByStaff: one(adminUsers, {
    fields: [leadActivities.performedBy],
    references: [adminUsers.id],
  }),
}));

export const communicationLogsRelations = relations(communicationLogs, ({ one }) => ({
  // patientId XOR leadId — enforced in application code, not by the schema.
  patient: one(patients, {
    fields: [communicationLogs.patientId],
    references: [patients.id],
  }),
  lead: one(leads, { fields: [communicationLogs.leadId], references: [leads.id] }),
  performedByStaff: one(adminUsers, {
    fields: [communicationLogs.performedBy],
    references: [adminUsers.id],
  }),
}));

/* ── Workflow & audit ────────────────────────────────────────────────── */

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  patient: one(patients, { fields: [tasks.patientId], references: [patients.id] }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
  branch: one(branches, { fields: [tasks.branchId], references: [branches.id] }),
  assignedToStaff: one(adminUsers, {
    fields: [tasks.assignedTo],
    references: [adminUsers.id],
    relationName: 'taskAssignee',
  }),
  createdByStaff: one(adminUsers, {
    fields: [tasks.createdBy],
    references: [adminUsers.id],
    relationName: 'taskCreator',
  }),
  comments: many(taskComments),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  // authorId points at admin_users or user depending on authorType, so it is
  // deliberately not modelled as a relation.
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(adminUsers, { fields: [auditLogs.actorId], references: [adminUsers.id] }),
  patient: one(patients, { fields: [auditLogs.patientId], references: [patients.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  // userId always means admin_users.id while userType is 'admin' — see
  // lib/notifications.ts, which is the single writer.
  recipient: one(adminUsers, {
    fields: [notifications.userId],
    references: [adminUsers.id],
  }),
}));

/* ── Settings ────────────────────────────────────────────────────────── */

export const messageTemplatesRelations = relations(messageTemplates, ({ one }) => ({
  // NULL branchId = a clinic-wide override.
  branch: one(branches, { fields: [messageTemplates.branchId], references: [branches.id] }),
  updatedByStaff: one(adminUsers, {
    fields: [messageTemplates.updatedBy],
    references: [adminUsers.id],
  }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [userPreferences.adminUserId],
    references: [adminUsers.id],
  }),
}));
