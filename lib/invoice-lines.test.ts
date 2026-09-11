import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildExtraDiscountLine,
  buildPatientDiscountLine,
  isDuplicateCodeRedemption,
  isDuplicateInvoiceNumber,
  materialiseLines,
  type DraftLine,
} from './invoice-lines.ts';

const procedure = (unitPrice: number, discountAmount = 0, quantity = 1): DraftLine => ({
  description: 'Procedure',
  quantity,
  unitPrice,
  discountAmount,
  itemType: 'procedure',
});

describe('buildExtraDiscountLine', () => {
  it('stores the discount as a negative line', () => {
    const line = buildExtraDiscountLine([procedure(20000)], {
      discountType: 'percentage',
      value: 10,
      label: 'Discount (10%) — goodwill',
    });
    assert.ok(line);
    assert.equal(line.unitPrice, -2000);
    assert.equal(line.quantity, 1);
    assert.equal(line.itemType, 'discount');
    // The magnitude lives in unitPrice; discountAmount stays 0 on a discount
    // line, which is what keeps computeInvoiceTotals from counting it twice.
    assert.equal(line.discountAmount, 0);
  });

  it('returns null when there is nothing left to discount', () => {
    const lines: DraftLine[] = [
      procedure(20000),
      { ...procedure(0), unitPrice: -20000, itemType: 'discount' },
    ];
    assert.equal(
      buildExtraDiscountLine(lines, { discountType: 'percentage', value: 10, label: 'x' }),
      null
    );
  });

  it('computes against the net, seeing an existing discount LINE', () => {
    const lines: DraftLine[] = [
      procedure(20000),
      { ...procedure(0), unitPrice: -4000, itemType: 'discount' },
    ];
    const line = buildExtraDiscountLine(lines, {
      discountType: 'percentage',
      value: 10,
      label: 'x',
    });
    // 10% of the remaining 16,000. Projecting drafts without draftAmount()
    // would score that discount line as 0 and wrongly give -2000.
    assert.equal(line?.unitPrice, -1600);
  });

  it('computes against the net, seeing a per-line discountAmount', () => {
    const line = buildExtraDiscountLine([procedure(20000, 5000)], {
      discountType: 'percentage',
      value: 10,
      label: 'x',
    });
    assert.equal(line?.unitPrice, -1500);
  });
});

describe('the patient and extra discounts stack without suppressing each other', () => {
  const plan = [procedure(20000)];

  it('an extra discount line does not suppress the patient discount', () => {
    const extra = buildExtraDiscountLine(plan, {
      discountType: 'fixed',
      value: 3000,
      label: 'Goodwill',
    })!;
    // The guard tests discountAmount > 0, and a discount LINE carries 0 — so
    // the patient discount survives regardless of ordering.
    const patient = buildPatientDiscountLine([...plan, extra], 10);
    assert.ok(patient, 'patient discount must still apply');
    // Its own base is the gross subtotal, excluding discount lines.
    assert.equal(patient.unitPrice, -2000);
  });

  it('produces an invoice that reconciles and stays non-negative', () => {
    const patient = buildPatientDiscountLine(plan, 10)!;
    const withPatient = [...plan, patient];
    const extra = buildExtraDiscountLine(withPatient, {
      discountType: 'percentage',
      value: 50,
      label: 'Half off the rest',
    })!;

    const { rows, totals } = materialiseLines('inv-1', [...withPatient, extra], new Date());

    assert.equal(totals.subtotal, 20000);
    assert.equal(totals.discountTotal, 2000 + 9000);
    assert.equal(totals.totalAmount, 9000);
    assert.equal(
      rows.reduce((sum, r) => sum + r.amount, 0),
      totals.totalAmount
    );
  });

  it('refuses to materialise an over-discounted invoice', () => {
    const lines: DraftLine[] = [
      procedure(20000),
      { ...procedure(0), unitPrice: -15000, itemType: 'discount' },
      { ...procedure(0), unitPrice: -15000, itemType: 'discount' },
    ];
    // Hand-built rather than via buildExtraDiscountLine, which could not
    // produce this — the assertion is the backstop for every other writer.
    assert.throws(() => materialiseLines('inv-2', lines, new Date()), /exceeds its subtotal/);
  });

  it('is still skipped when a plan line carries its own discount', () => {
    // Pre-existing behaviour, unchanged: the two implicit discounts never stack.
    assert.equal(buildPatientDiscountLine([procedure(20000, 5000)], 10), null);
  });
});

describe('duplicate-key predicates tell the two 1062s apart', () => {
  const err = (sqlMessage: string) => Object.assign(new Error('dup'), { errno: 1062, sqlMessage });

  it('recognises an invoice-number race', () => {
    const e = err("Duplicate entry 'INV-MAIN-2609-00042' for key 'invoices.invoices_invoiceNumber_unique'");
    assert.equal(isDuplicateInvoiceNumber(e), true);
    assert.equal(isDuplicateCodeRedemption(e), false);
  });

  it('does NOT mistake a repeat redemption for a numbering race', () => {
    // Retrying this one is useless: it fails identically every attempt, and the
    // caller would then report a numbering problem that never happened.
    const e = err("Duplicate entry 'code-1-patient-1' for key 'invoices.uq_inv_code_patient'");
    assert.equal(isDuplicateInvoiceNumber(e), false);
    assert.equal(isDuplicateCodeRedemption(e), true);
  });

  it('ignores errors that are not duplicate keys', () => {
    assert.equal(isDuplicateInvoiceNumber(Object.assign(new Error('x'), { errno: 1213 })), false);
    assert.equal(isDuplicateCodeRedemption(new Error('x')), false);
    assert.equal(isDuplicateInvoiceNumber(null), false);
  });
});
