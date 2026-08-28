/**
 * Patient identity — pure functions only.
 *
 * Deliberately free of any database or Next.js import so it can be unit
 * tested with `node --test`, which resolves real file paths and cannot follow
 * the "@/" alias. lib/patients.ts holds the queries and re-exports these.
 */

export class MrnGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MrnGenerationError';
  }
}

/** Width of the numeric part of an MRN. */
export const MRN_SEQUENCE_WIDTH = 6;

/* ── Medical Record Number ───────────────────────────────────────────── */

/**
 * Format: MAIN-000123 — branch code, then a zero-padded per-branch sequence.
 *
 * Readable aloud over the phone, sorts correctly, stays unique when a second
 * branch opens, and the prefix immediately says which clinic registered the
 * patient. Width is 4 + 1 + 6 = 11 of the 20 characters available, leaving
 * room for a longer branch code.
 *
 * The zero padding is load-bearing: because every sequence is the same width,
 * ORDER BY mrn DESC is the same as ordering numerically, so finding the next
 * number is an index range scan on patients_mrn_unique rather than a scan of
 * the table.
 */
export function formatMrn(branchCode: string, sequence: number): string {
  return `${branchCode.toUpperCase()}-${String(sequence).padStart(MRN_SEQUENCE_WIDTH, '0')}`;
}

/** Pull the numeric part back out of an MRN. Returns 0 if it does not parse. */
export function parseMrnSequence(mrn: string): number {
  const match = /-(\d+)$/.exec(mrn);
  return match ? Number(match[1]) : 0;
}

/** MySQL duplicate-key errno — how an MRN collision surfaces under a race. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errno' in error &&
    (error as { errno?: number }).errno === 1062
  );
}

/* ── Phone numbers ───────────────────────────────────────────────────── */

/**
 * Normalise a Pakistani phone number to +92XXXXXXXXXX.
 *
 * phone is the ONLY required contact field on a patient, and it is what
 * duplicate detection keys on — so "0300 123 4567", "0300-1234567" and
 * "+92 300 1234567" must all collapse to one value, or the same person is
 * registered three times and their history splits three ways.
 *
 * Anything that does not look like a Pakistani number is returned digit-only
 * rather than rejected: the clinic will occasionally have an overseas patient,
 * and refusing to register them would be worse than storing a looser value.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  const digits = String(input).replace(/[^\d+]/g, '');
  if (!digits) return null;

  let rest = digits.startsWith('+') ? digits.slice(1) : digits;

  // 00 as the international prefix.
  if (rest.startsWith('00')) rest = rest.slice(2);

  // Local form: 03001234567 -> 923001234567
  if (rest.length === 11 && rest.startsWith('0')) {
    rest = `92${rest.slice(1)}`;
  }
  // Bare subscriber number: 3001234567 -> 923001234567
  else if (rest.length === 10 && rest.startsWith('3')) {
    rest = `92${rest}`;
  }

  if (rest.startsWith('92') && rest.length === 12) {
    return `+${rest}`;
  }

  // Not a Pakistani number; keep it, but in a consistent shape.
  return digits.startsWith('+') ? `+${rest}` : rest;
}

/** Last 9 digits — what to compare on, since prefixes vary in how they were typed. */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/* ── Display helpers ─────────────────────────────────────────────────── */

/**
 * Full name for display.
 *
 * lastName is nullable — never assume both halves exist, or a patient
 * registered with one name renders as "Ahmed undefined".
 */
export function patientName(patient: {
  firstName: string;
  lastName?: string | null;
}): string {
  return [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim();
}

/** 'Ahmed Khan (MAIN-000123)' — for pickers and audit descriptions. */
export function patientLabel(patient: {
  firstName: string;
  lastName?: string | null;
  mrn: string;
}): string {
  return `${patientName(patient)} (${patient.mrn})`;
}
