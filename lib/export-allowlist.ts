/**
 * What the full data export may contain, per table.
 *
 * The allowlist is the security boundary: `select *` is one careless refactor
 * away from dumping password hashes and OTPs into a file the clinic will pass
 * around by email. Columns are named explicitly, and the excluded ones are
 * excluded on purpose:
 *
 *   admin_users.password            — bcrypt hashes are still secrets
 *   user.otp / user.otp_expiry      — live sign-in codes
 *   account.access_token / refresh_token / id_token
 *   sessions.*, verification_tokens.*, login_attempts.*
 *                                   — auth machinery, not clinic data
 *
 * patient_files exports storageKey (a pointer), never bytes.
 */
export const EXPORT_TABLES: ReadonlyArray<{ table: string; columns: readonly string[] }> = [
  { table: 'branches', columns: ['id', 'name', 'code', 'address', 'city', 'phone', 'email', 'timezone', 'isActive', 'createdAt'] },
  { table: 'chairs', columns: ['id', 'branchId', 'name', 'isActive'] },
  { table: 'clinic_settings', columns: ['id', 'clinicName', 'address', 'phone', 'email', 'workStartTime', 'workEndTime', 'slotMinutes', 'currency'] },
  { table: 'admin_roles', columns: ['id', 'name', 'permissions', 'createdAt'] },
  { table: 'admin_users', columns: ['id', 'email', 'name', 'roleId', 'branchId', 'phone', 'staffType', 'licenseNumber', 'isActive', 'createdAt'] },
  { table: 'procedures', columns: ['id', 'code', 'name', 'category', 'defaultPrice', 'durationMinutes', 'isPerTooth', 'defaultRecallMonths', 'isActive'] },
  { table: 'patients', columns: ['id', 'mrn', 'branchId', 'firstName', 'lastName', 'gender', 'dateOfBirth', 'cnic', 'phone', 'altPhone', 'email', 'address', 'city', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'guardianName', 'bloodGroup', 'occupation', 'referredBy', 'leadId', 'defaultDiscountPercent', 'medicalNotes', 'dentalNotes', 'hasAlerts', 'status', 'createdAt'] },
  { table: 'patient_conditions', columns: ['id', 'patientId', 'conditionType', 'name', 'severity', 'isAlert', 'notes', 'status', 'createdAt'] },
  { table: 'tooth_conditions', columns: ['id', 'patientId', 'toothNumber', 'surfaces', 'conditionType', 'status', 'notes', 'visitId', 'resolvedAt', 'recordedAt'] },
  { table: 'patient_files', columns: ['id', 'patientId', 'visitId', 'toothNumber', 'fileType', 'photoStage', 'title', 'storageKey', 'mimeType', 'sizeBytes', 'createdAt'] },
  { table: 'appointments', columns: ['id', 'patientId', 'branchId', 'dentistId', 'chairId', 'startAt', 'endAt', 'type', 'status', 'isWalkIn', 'reasonNote', 'cancellationReason', 'cancelledAt', 'confirmedAt', 'checkedInAt', 'completedAt', 'createdAt'] },
  { table: 'visits', columns: ['id', 'patientId', 'branchId', 'appointmentId', 'dentistId', 'visitDate', 'chiefComplaint', 'examinationNotes', 'treatmentNotes', 'bloodPressure', 'followUpInstructions', 'status', 'createdAt'] },
  { table: 'visit_procedures', columns: ['id', 'visitId', 'patientId', 'procedureId', 'treatmentPlanItemId', 'teeth', 'surfaces', 'performedBy', 'status', 'price', 'notes', 'createdAt'] },
  { table: 'visit_diagnoses', columns: ['id', 'visitId', 'patientId', 'toothNumber', 'code', 'description', 'createdAt'] },
  { table: 'prescriptions', columns: ['id', 'visitId', 'patientId', 'dentistId', 'notes', 'createdAt'] },
  { table: 'prescription_items', columns: ['id', 'prescriptionId', 'drugName', 'dosage', 'frequency', 'durationDays', 'instructions', 'sortOrder'] },
  { table: 'treatment_plans', columns: ['id', 'patientId', 'branchId', 'dentistId', 'title', 'status', 'totalAmount', 'discountTotal', 'netAmount', 'proposedAt', 'acceptedAt', 'acceptedNote', 'cancelReason', 'notes', 'createdAt'] },
  { table: 'treatment_plan_items', columns: ['id', 'treatmentPlanId', 'procedureId', 'teeth', 'surfaces', 'unitPrice', 'quantity', 'discountType', 'discountValue', 'netAmount', 'status', 'sortOrder', 'notes'] },
  { table: 'invoices', columns: ['id', 'invoiceNumber', 'patientId', 'branchId', 'visitId', 'treatmentPlanId', 'issueDate', 'dueDate', 'subtotal', 'discountTotal', 'totalAmount', 'paidAmount', 'status', 'notes', 'createdAt'] },
  { table: 'invoice_items', columns: ['id', 'invoiceId', 'procedureId', 'description', 'teeth', 'quantity', 'unitPrice', 'discountAmount', 'amount', 'itemType'] },
  { table: 'payments', columns: ['id', 'patientId', 'branchId', 'invoiceId', 'amount', 'type', 'method', 'transactionId', 'paymentDate', 'notes', 'createdAt'] },
  { table: 'leads', columns: ['id', 'branchId', 'name', 'phone', 'email', 'source', 'interestNote', 'status', 'lostReason', 'assignedTo', 'nextFollowUpAt', 'convertedPatientId', 'convertedAt', 'createdAt'] },
  { table: 'lead_activities', columns: ['id', 'leadId', 'activityType', 'note', 'outcome', 'performedBy', 'createdAt'] },
  { table: 'recalls', columns: ['id', 'patientId', 'branchId', 'recallType', 'dueDate', 'intervalMonths', 'status', 'appointmentId', 'sourceVisitId', 'notes', 'createdAt'] },
  { table: 'communication_logs', columns: ['id', 'patientId', 'leadId', 'channel', 'direction', 'subject', 'status', 'templateKey', 'referenceType', 'referenceId', 'createdAt'] },
  { table: 'tasks', columns: ['id', 'title', 'description', 'patientId', 'leadId', 'branchId', 'assignedTo', 'dueDate', 'status', 'priority', 'createdAt'] },
  { table: 'task_comments', columns: ['id', 'taskId', 'authorId', 'authorType', 'authorName', 'comment', 'createdAt'] },
  { table: 'audit_logs', columns: ['id', 'actorId', 'actorEmail', 'action', 'entityType', 'entityId', 'patientId', 'branchId', 'ipAddress', 'createdAt'] },
];
