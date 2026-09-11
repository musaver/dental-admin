import { z } from 'zod';
import {
  BLOOD_GROUP,
  GENDER,
  PATIENT_STATUS,
  valuesOf,
} from '@/lib/enums';

/**
 * Patient input validation, shared by the API route and the form.
 *
 * Lengths mirror the column widths exactly. MySQL in strict mode rejects an
 * over-long value at INSERT, which would surface as a 500 halfway through
 * registering someone — better to return a field-level 400 the form can show.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const patientCreateSchema = z.object({
  // The only required contact field. lastName and email are both nullable in
  // the schema and genuinely absent for many patients.
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  phone: z.string().trim().min(6, 'A contact number is required').max(20),

  lastName: optionalText(100),
  gender: z.enum(valuesOf(GENDER) as [string, ...string[]]).nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  cnic: optionalText(15),
  altPhone: optionalText(20),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .max(255)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  address: optionalText(65_535),
  city: optionalText(100),

  emergencyContactName: optionalText(255),
  emergencyContactPhone: optionalText(20),
  emergencyContactRelation: optionalText(50),
  guardianName: optionalText(255),

  bloodGroup: z.enum(BLOOD_GROUP as unknown as [string, ...string[]]).nullable().optional(),
  occupation: optionalText(100),
  referredBy: optionalText(255),

  // Percent, 0-100 — resolved to an absolute amount at invoicing time.
  defaultDiscountPercent: z.coerce.number().int().min(0).max(100).default(0),

  medicalNotes: optionalText(65_535),
  dentalNotes: optionalText(65_535),

  /** Head office may register into any branch; scoped staff may not. */
  branchId: z.string().max(255).optional(),

  /** Set when converting a lead, to keep both sides of the pair in step. */
  leadId: z.string().max(255).nullable().optional(),

  /** Suppresses the duplicate warning once a human has reviewed it. */
  allowDuplicate: z.boolean().optional(),
});

export const patientUpdateSchema = patientCreateSchema
  .partial()
  .extend({
    status: z.enum(valuesOf(PATIENT_STATUS) as [string, ...string[]]).optional(),
  })
  // mrn and branchId are identity, not attributes: changing either after
  // registration invalidates printed records and moves the patient's whole
  // clinical history between branches.
  .omit({ branchId: true, leadId: true, allowDuplicate: true });

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

/**
 * zod issues keyed by dotted path.
 *
 * `flatten().fieldErrors` only knows about top-level keys, so every complaint
 * about a nested object collapses onto the object's own name — a form told
 * "newPatient is wrong" can highlight nothing. This keeps the path, giving
 * `newPatient.firstName`, and is a superset of flatten() for flat schemas.
 */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/** Turn a zod failure into the house error body. */
export function validationError(error: z.ZodError) {
  return {
    error: 'Please correct the highlighted fields.',
    details: fieldErrors(error),
  };
}
