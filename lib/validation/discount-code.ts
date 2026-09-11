import { z } from 'zod';
import { DISCOUNT_TYPE, valuesOf } from '@/lib/enums';

/**
 * Discount code validation, shared by the create and update routes.
 *
 * Shared rather than declared inline per route because the two WILL drift, and
 * the whole point of validating here is that a code is authored once and then
 * applied silently to every invoice it touches. The schema has no CHECK
 * constraints (CONVENTIONS.md), so this is the only guard that will ever exist.
 */

/** A single rupee ceiling, to catch a fat-fingered fixed amount. */
const MAX_FIXED_PKR = 10_000_000;

/**
 * Dates arrive as 'YYYY-MM-DD', deliberately NOT through z.coerce.date().
 *
 * A bare datetime-local string has no offset, so `new Date(str)` resolves it in
 * the Node process's local zone: a no-op on Vercel (TZ=UTC) but a five-hour
 * shift on a Karachi dev box, which would expire codes early on some machines
 * and not others. Converting from a date key through lib/datetime.ts keeps the
 * stored value naive clinic wall clock, like every other datetime column.
 */
const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .nullable()
  .optional();

export const discountCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Give the code a name')
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only.'),
    description: z.string().trim().max(255).nullable().optional(),
    discountType: z.enum(valuesOf(DISCOUNT_TYPE) as [string, ...string[]]),
    discountValue: z.coerce.number().int().min(1, 'A discount of zero is not a discount'),
    /** Null means every branch. */
    branchId: z.string().max(255).nullable().optional(),
    validFrom: dateKey,
    validUntil: dateKey,
    /** Null means unlimited. */
    maxRedemptions: z.coerce.number().int().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  // The bound depends on a sibling field, so this cannot be a plain .max(100).
  .superRefine((v, ctx) => {
    if (v.discountType === DISCOUNT_TYPE.PERCENTAGE && v.discountValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'A percentage discount cannot exceed 100%.',
      });
    }
    if (v.discountType === DISCOUNT_TYPE.FIXED && v.discountValue > MAX_FIXED_PKR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        // Whole PKR, never paisa — see the header of lib/money.ts.
        message: 'That fixed discount looks like a typo.',
      });
    }
    if (v.validFrom && v.validUntil && v.validFrom > v.validUntil) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: 'The end date cannot fall before the start date.',
      });
    }
  });

export type DiscountCodeInput = z.infer<typeof discountCodeSchema>;
