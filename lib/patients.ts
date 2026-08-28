import { db } from '@/lib/db';
import { branches, patients } from '@/lib/schema';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import {
  formatMrn,
  MRN_SEQUENCE_WIDTH,
  MrnGenerationError,
  parseMrnSequence,
  phoneMatchKey,
} from '@/lib/patient-identity';

// Pure identity helpers live in lib/patient-identity.ts so they stay unit
// testable; re-exported here so callers need only one import.
export * from '@/lib/patient-identity';

/**
 * Patient identity: MRN generation and phone normalisation.
 *
 * Both belong in phase 1, not a later data-quality pass. Retrofitting a
 * numbering scheme means either a mixed-format table or renumbering records
 * that have already been printed on prescriptions, and retrofitting phone
 * normalisation means reconciling duplicates that have accumulated clinical
 * history in the meantime.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Next free MRN for a branch.
 *
 * MUST be called inside the same transaction as the patient INSERT, and the
 * caller must be prepared to retry: two receptionists registering at the same
 * instant can read the same highest number. The unique index on patients.mrn
 * is the actual guarantee; this provides liveness, not correctness.
 */
export async function nextMrn(tx: Executor, branchId: string): Promise<string> {
  const [branch] = await tx
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);

  if (!branch) {
    throw new MrnGenerationError(`Branch ${branchId} does not exist.`);
  }

  const prefix = `${branch.code.toUpperCase()}-`;

  const [highest] = await tx
    .select({ mrn: patients.mrn })
    .from(patients)
    .where(like(patients.mrn, `${prefix}%`))
    .orderBy(desc(patients.mrn))
    .limit(1);

  const next = highest ? parseMrnSequence(highest.mrn) + 1 : 1;

  if (next >= 10 ** MRN_SEQUENCE_WIDTH) {
    throw new MrnGenerationError(
      `Branch ${branch.code} has exhausted its ${MRN_SEQUENCE_WIDTH}-digit MRN range.`
    );
  }

  return formatMrn(branch.code, next);
}

/* ── Duplicate detection ─────────────────────────────────────────────── */

export interface DuplicateCandidate {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  dateOfBirth: Date | null;
  status: string;
  reason: 'phone' | 'name-and-dob';
}

/**
 * Possible existing records for someone about to be registered.
 *
 * Run BEFORE creating a patient, and before converting a lead. Without it a
 * returning patient who enquires again silently gets a second chart, and with
 * no foreign keys nothing will ever point that out — their history simply
 * splits in two.
 *
 * Advisory only: it returns candidates for a human to judge. Names repeat, and
 * families share phone numbers.
 */
export async function findDuplicatePatients(
  input: {
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    dateOfBirth?: Date | null;
  },
  options: { branchIds?: string[] | null; excludePatientId?: string } = {}
): Promise<DuplicateCandidate[]> {
  const matchKey = phoneMatchKey(input.phone);
  const conditions = [];

  if (matchKey) {
    // Compare on the trailing digits so formatting differences do not hide a match.
    conditions.push(sql`RIGHT(REGEXP_REPLACE(${patients.phone}, '[^0-9]', ''), 9) = ${matchKey}`);
  }

  if (input.firstName && input.dateOfBirth) {
    conditions.push(
      and(
        eq(patients.firstName, input.firstName),
        sql`DATE(${patients.dateOfBirth}) = DATE(${input.dateOfBirth})`
      )!
    );
  }

  if (!conditions.length) return [];

  const branchFilter =
    options.branchIds && options.branchIds.length
      ? sql`${patients.branchId} IN ${options.branchIds}`
      : undefined;

  const rows = await db
    .select({
      id: patients.id,
      mrn: patients.mrn,
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: patients.phone,
      dateOfBirth: patients.dateOfBirth,
      status: patients.status,
    })
    .from(patients)
    .where(and(or(...conditions), branchFilter))
    .limit(10);

  return rows
    .filter((row) => row.id !== options.excludePatientId)
    .map((row) => ({
      ...row,
      reason: phoneMatchKey(row.phone) === matchKey ? ('phone' as const) : ('name-and-dob' as const),
    }));
}
