import { db } from '@/lib/db';
import { branches, patients } from '@/lib/schema';
import { nextMrn, normalizePhone } from '@/lib/patients';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, PATIENT_STATUS } from '@/lib/enums';
import type { StaffContext } from '@/lib/rbac';
import type { PatientCreateInput } from '@/lib/validation/patient';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * Registering a patient.
 *
 * Two paths arrive here: the registration form, and booking an appointment for
 * someone who has never been seen before. Both mint an MRN and both must fill
 * all 28 columns of a table with no foreign keys and no defaults worth relying
 * on, so a second hand-written copy of the row is how a column quietly ends up
 * null forever — hence one builder.
 *
 * Lead conversion (app/api/leads/[id]/convert/route.ts) still builds its own,
 * because it writes the leads.convertedPatientId ↔ patients.leadId pair and
 * audits after commit rather than inside the transaction. Worth folding in, but
 * not while changing something else.
 */

/** MRN generation races on a shared read; the unique index catches it. */
export const MRN_RETRIES = 5;

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The row shape insertPatient() writes and returns. */
export type PatientRow = typeof patients.$inferInsert & { id: string; mrn: string };

/**
 * Does this branch exist?
 *
 * Checked before anything is written: nextMrn() throws for a missing branch,
 * but only after the transaction has opened, which turns a mistyped branch id
 * into a 500 rather than a field-level 400.
 */
export async function branchExists(branchId: string): Promise<boolean> {
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  return Boolean(branch);
}

export interface InsertPatientOptions {
  /** Already parsed through patientCreateSchema (or a pick() of it). */
  input: Partial<PatientCreateInput> & Pick<PatientCreateInput, 'firstName' | 'phone'>;
  /** Resolved by resolveWritingBranch() — never taken raw from the client. */
  branchId: string;
  actor: StaffContext;
  now: Date;
  /** For the audit log's IP and user agent. */
  request?: Request;
  /**
   * Fields the caller derives rather than collects. Lead conversion sets
   * leadId and writes the enquiry source into referredBy.
   */
  overrides?: Partial<Pick<PatientRow, 'leadId' | 'referredBy' | 'dentalNotes'>>;
}

/**
 * Insert a patient and their audit entry.
 *
 * MUST be called inside a transaction, and the caller MUST retry on
 * isDuplicateKeyError() up to MRN_RETRIES — nextMrn() reads the highest number
 * for the branch, so two receptionists registering at the same instant read the
 * same one. The `patients_mrn_unique` index is the actual guarantee; the retry
 * is what turns a lost race into a second attempt rather than a 500.
 */
export async function insertPatient(
  tx: Executor,
  { input, branchId, actor, now, request, overrides }: InsertPatientOptions
): Promise<PatientRow> {
  const mrn = await nextMrn(tx, branchId);

  const row: PatientRow = {
    id: uuidv4(),
    mrn,
    branchId,
    firstName: input.firstName,
    lastName: input.lastName ?? null,
    gender: input.gender ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    cnic: input.cnic ?? null,
    // Phone is the only required contact field and what duplicate detection
    // keys on, so every number is normalised on the way in.
    phone: normalizePhone(input.phone)!,
    altPhone: normalizePhone(input.altPhone),
    email: input.email ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: normalizePhone(input.emergencyContactPhone),
    emergencyContactRelation: input.emergencyContactRelation ?? null,
    guardianName: input.guardianName ?? null,
    bloodGroup: input.bloodGroup ?? null,
    occupation: input.occupation ?? null,
    referredBy: overrides?.referredBy ?? input.referredBy ?? null,
    leadId: overrides?.leadId ?? input.leadId ?? null,
    defaultDiscountPercent: input.defaultDiscountPercent ?? 0,
    medicalNotes: input.medicalNotes ?? null,
    dentalNotes: overrides?.dentalNotes ?? input.dentalNotes ?? null,
    hasAlerts: false,
    portalUserId: null,
    status: PATIENT_STATUS.ACTIVE,
    registeredBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };

  await tx.insert(patients).values(row);

  await writeAuditLog(
    {
      actor,
      action: AUDIT_ACTION.CREATE,
      entityType: AUDIT_ENTITY.PATIENT,
      entityId: row.id,
      patientId: row.id,
      branchId,
      after: row,
      request,
    },
    tx
  );

  return row;
}
