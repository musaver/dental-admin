# Fee Calculations Module — Admin Project

A comprehensive fee-accounting module: configurable fee structures, discounts/scholarships,
monthly invoice generation per enrolled student, partial/installment payments + refunds, and a
reporting dashboard.

## Status: ✅ Code complete. Build + type-check pass. ⏳ Needs the DB migration run once.

## TO ACTIVATE
Run the migration once on the shared MySQL DB (creates 6 tables):
`admin/drizzle/fee-calculations.sql`

Then the **💰 Fee Calculations** item appears in the admin sidebar.

## Model (all money = whole PKR `int`, matching `courses.price`)
- `fee_structures` (per course: base + billing cycle) → `fee_components` (extra line items)
- `fee_discounts` (scholarships/discounts; scope student|batch|course; percentage|fixed)
- `fee_invoices` (per-student per-month charge) → `fee_invoice_items` (itemized snapshot)
- `fee_payments` (payments/installments + refunds)

Schema lives in `admin/lib/schema.ts` (mirrored into `web/lib/schema.ts` for parity; web doesn't use it).
Helpers: `admin/lib/money.ts` (formatPKR, computeDiscountAmount, deriveInvoiceStatus), `admin/lib/fee.ts`
(`recomputeInvoice` — recalculates paidAmount/status from payments; preserves `waived`).

## Workflow
1. **Fee Structures** (`/fee-calculations/structures`) — define base fee per course (auto-fills from
   course price) + components (recurring or one-time, e.g. exam fee). Components managed inline on edit.
2. **Discounts** (`/fee-calculations/discounts`) — scholarships/discounts scoped to a student, batch, or course.
3. **Generate** (`/fee-calculations/generate`) — pick batch + month → one invoice per enrolled
   (completed-order) student, snapshotting base + components − applicable discounts. **Idempotent**
   (unique on userId+batchId+period; re-running skips existing). One-time components only on a student's
   first invoice for the batch.
4. **Invoices** (`/fee-calculations/invoices`) — filter by batch/period/status; open one to see the
   itemized breakdown, balance, payment history, and to **Record Payment / Refund**, **Waive**, or delete.
5. **Dashboard** (`/fee-calculations`) — Billed / Collected / Outstanding / Refunded cards with a date
   filter, status breakdown, section links, and recent invoices.

## Balance math
`paidAmount = SUM(payments) − SUM(refunds)`; status auto-derives unpaid→partial→paid on every payment
change (via `recomputeInvoice`). `waived` is set manually and preserved through recompute. Outstanding
on the dashboard excludes `waived`.

## API routes (mirror the existing `orders` patterns)
`/api/fee-structures` (+[id]), `/api/fee-components` (+[id]), `/api/fee-discounts` (+[id]),
`/api/fee-invoices` (+[id], +`/generate`), `/api/fee-payments` (+[id]), `/api/fee-calculations/stats`.

## Auth
Pages protected by `admin/middleware.ts` (added `/fee-calculations` to protected routes + matcher),
same as other admin sections. API routes follow the existing (route-level unauthenticated) convention.

## Verification (end-to-end)
1. Run the SQL; confirm 6 tables. `cd admin && npm run build` passes (already verified).
2. Create a structure for a course (+ an Exam Fee component) and a discount (e.g. 20%).
3. Generate invoices for a batch + month → one per enrolled student, total = base + components − discount;
   re-run skips duplicates.
4. Open an invoice → Record partial payment (status → partial) → pay remainder (→ paid) → Record refund
   (recomputes). Delete a payment → recomputes.
5. Dashboard with a date range shows matching Billed/Collected/Outstanding/Refunded.

## Notes
- Percentages/amounts are whole numbers. Switch the `int` columns to `decimal` if fractional values are needed.
- Invoices snapshot amounts at generation, so later price/component changes don't rewrite history.
- Discounts stack (student + batch + course), each computed on the base, clamped to the charge total.
