import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertInvoiceTotals,
  computeDiscountAmount,
  computeInvoiceTotals,
  computeItemNet,
  computeLineAmount,
  computePlanTotals,
  deriveInvoiceStatus,
  formatPKR,
  invoiceBalance,
  recomputeInvoiceStatus,
  signedAmount,
  sumPayments,
  type InvoiceLine,
} from './money.ts';

describe('formatPKR', () => {
  it('renders whole rupees, never dividing by 100', () => {
    // Seeded procedure prices: these are rupees, not paisa.
    assert.equal(formatPKR(1000), 'Rs. 1,000');
    assert.equal(formatPKR(22000), 'Rs. 22,000');
    // en-PK groups in thousands (150,000), not lakhs. Only en-IN would give
    // 1,50,000 — do not "correct" the locale to en-IN.
    assert.equal(formatPKR(150000), 'Rs. 150,000');
    assert.equal(formatPKR(2500000), 'Rs. 2,500,000');
  });

  it('handles nothing gracefully', () => {
    assert.equal(formatPKR(0), 'Rs. 0');
    assert.equal(formatPKR(null), 'Rs. 0');
    assert.equal(formatPKR(undefined), 'Rs. 0');
  });
});

describe('computeDiscountAmount', () => {
  it('computes a percentage', () => {
    assert.equal(computeDiscountAmount(20000, { discountType: 'percentage', value: 10 }), 2000);
  });

  it('passes a fixed amount through', () => {
    assert.equal(computeDiscountAmount(20000, { discountType: 'fixed', value: 3500 }), 3500);
  });

  it('never exceeds the base, so a mistyped 120% cannot go negative', () => {
    assert.equal(computeDiscountAmount(1000, { discountType: 'percentage', value: 120 }), 1000);
    assert.equal(computeDiscountAmount(1000, { discountType: 'fixed', value: 99999 }), 1000);
  });

  it('treats missing or nonsensical input as no discount', () => {
    assert.equal(computeDiscountAmount(1000, null), 0);
    assert.equal(computeDiscountAmount(1000, { discountType: 'percentage', value: 0 }), 0);
    assert.equal(computeDiscountAmount(1000, { discountType: 'percentage', value: -5 }), 0);
    assert.equal(computeDiscountAmount(1000, { discountType: null, value: null }), 0);
  });

  it('rounds to whole rupees', () => {
    // 7.5% of 1234 = 92.55
    assert.equal(computeDiscountAmount(1234, { discountType: 'percentage', value: 7.5 }), 93);
  });
});

describe('deriveInvoiceStatus', () => {
  it('maps amounts to the three derivable states', () => {
    assert.equal(deriveInvoiceStatus(10000, 0), 'unpaid');
    assert.equal(deriveInvoiceStatus(10000, 4000), 'partial');
    assert.equal(deriveInvoiceStatus(10000, 10000), 'paid');
  });

  it('counts an overpayment as paid', () => {
    assert.equal(deriveInvoiceStatus(10000, 12000), 'paid');
  });
});

describe('recomputeInvoiceStatus', () => {
  it('keeps a waived invoice waived even once money arrives', () => {
    // The write-off was a decision; a later payment must not silently undo it.
    assert.equal(
      recomputeInvoiceStatus({ totalAmount: 10000, paidAmount: 10000, currentStatus: 'waived' }),
      'waived'
    );
  });

  it('reads as refunded when the payments have all been given back', () => {
    // Otherwise it reappears in the outstanding report as if never settled.
    assert.equal(
      recomputeInvoiceStatus({ totalAmount: 10000, paidAmount: 0, hasRefunds: true }),
      'refunded'
    );
  });

  it('is plain unpaid when nothing was ever paid', () => {
    assert.equal(
      recomputeInvoiceStatus({ totalAmount: 10000, paidAmount: 0, hasRefunds: false }),
      'unpaid'
    );
  });

  it('is still partial when only some of a refunded invoice came back', () => {
    assert.equal(
      recomputeInvoiceStatus({ totalAmount: 10000, paidAmount: 3000, hasRefunds: true }),
      'partial'
    );
  });
});

describe('payment signs', () => {
  it('treats refunds as negative and everything else as positive', () => {
    assert.equal(signedAmount({ type: 'payment', amount: 5000 }), 5000);
    assert.equal(signedAmount({ type: 'advance', amount: 5000 }), 5000);
    assert.equal(signedAmount({ type: 'adjustment', amount: 500 }), 500);
    assert.equal(signedAmount({ type: 'refund', amount: 5000 }), -5000);
  });

  it('ignores a stray negative in the column', () => {
    // amount is always stored positive; direction lives in type.
    assert.equal(signedAmount({ type: 'payment', amount: -5000 }), 5000);
    assert.equal(signedAmount({ type: 'refund', amount: -5000 }), -5000);
  });

  it('nets a sequence correctly', () => {
    assert.equal(
      sumPayments([
        { type: 'payment', amount: 10000 },
        { type: 'payment', amount: 5000 },
        { type: 'refund', amount: 3000 },
      ]),
      12000
    );
  });

  it('nets to zero when everything is refunded', () => {
    assert.equal(
      sumPayments([
        { type: 'payment', amount: 10000 },
        { type: 'refund', amount: 10000 },
      ]),
      0
    );
  });
});

describe('invoiceBalance', () => {
  it('is computed, because there is no balance column', () => {
    assert.equal(invoiceBalance({ totalAmount: 10000, paidAmount: 4000 }), 6000);
    assert.equal(invoiceBalance({ totalAmount: 10000, paidAmount: 10000 }), 0);
  });

  it('goes negative on an overpayment, which the ledger shows as credit', () => {
    assert.equal(invoiceBalance({ totalAmount: 10000, paidAmount: 12000 }), -2000);
  });
});

describe('computeLineAmount', () => {
  it('multiplies by quantity — a per-tooth procedure across three teeth', () => {
    // RCT-Molar at 22000, teeth 11/12/13.
    assert.equal(computeLineAmount({ quantity: 3, unitPrice: 22000 }), 66000);
  });

  it('defaults quantity to 1', () => {
    assert.equal(computeLineAmount({ unitPrice: 22000 }), 22000);
  });

  it('subtracts the line discount', () => {
    assert.equal(computeLineAmount({ quantity: 2, unitPrice: 10000, discountAmount: 2500 }), 17500);
  });

  it('never lets a discount push the line negative', () => {
    assert.equal(computeLineAmount({ quantity: 1, unitPrice: 1000, discountAmount: 99999 }), 0);
  });
});

describe('computeInvoiceTotals', () => {
  const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
    quantity: 1,
    unitPrice: 0,
    discountAmount: 0,
    itemType: 'procedure',
    amount: 0,
    ...over,
  });

  it('sums a simple invoice', () => {
    const lines = [
      line({ unitPrice: 1000, amount: 1000 }),
      line({ quantity: 3, unitPrice: 22000, amount: 66000 }),
    ];
    const totals = computeInvoiceTotals(lines);
    assert.deepEqual(totals, { subtotal: 67000, discountTotal: 0, totalAmount: 67000 });
    assertInvoiceTotals(lines, totals);
  });

  it('counts per-line discounts once', () => {
    const lines = [line({ unitPrice: 20000, discountAmount: 2000, amount: 18000 })];
    const totals = computeInvoiceTotals(lines);
    assert.deepEqual(totals, { subtotal: 20000, discountTotal: 2000, totalAmount: 18000 });
    assertInvoiceTotals(lines, totals);
  });

  it('treats a discount LINE as negative without double-counting', () => {
    // This is the shape a patient-level default discount takes.
    const lines = [
      line({ unitPrice: 20000, amount: 20000 }),
      line({ itemType: 'discount', unitPrice: -3000, amount: -3000 }),
    ];
    const totals = computeInvoiceTotals(lines);
    assert.deepEqual(totals, { subtotal: 20000, discountTotal: 3000, totalAmount: 17000 });
    assertInvoiceTotals(lines, totals);
  });

  it('handles per-line and discount-line together', () => {
    const lines = [
      line({ quantity: 2, unitPrice: 10000, discountAmount: 1000, amount: 19000 }),
      line({ itemType: 'discount', unitPrice: -1900, amount: -1900 }),
    ];
    const totals = computeInvoiceTotals(lines);
    assert.deepEqual(totals, { subtotal: 20000, discountTotal: 2900, totalAmount: 17100 });
    assertInvoiceTotals(lines, totals);
  });

  it('is empty for an invoice with no lines', () => {
    assert.deepEqual(computeInvoiceTotals([]), {
      subtotal: 0,
      discountTotal: 0,
      totalAmount: 0,
    });
  });
});

describe('assertInvoiceTotals', () => {
  it('catches lines that do not reconcile with the header', () => {
    const lines: InvoiceLine[] = [
      { quantity: 1, unitPrice: 1000, discountAmount: 0, itemType: 'procedure', amount: 1000 },
    ];
    assert.throws(
      () => assertInvoiceTotals(lines, { subtotal: 1000, discountTotal: 0, totalAmount: 9999 }),
      /do not reconcile/
    );
  });
});

describe('computeItemNet', () => {
  it('applies a percentage discount to the gross', () => {
    assert.equal(
      computeItemNet({ quantity: 3, unitPrice: 22000, discountType: 'percentage', discountValue: 10 }),
      59400
    );
  });

  it('applies a fixed discount', () => {
    assert.equal(
      computeItemNet({ quantity: 1, unitPrice: 22000, discountType: 'fixed', discountValue: 2000 }),
      20000
    );
  });

  it('is just the gross with no discount', () => {
    assert.equal(computeItemNet({ quantity: 2, unitPrice: 15000 }), 30000);
  });
});

describe('computePlanTotals', () => {
  it('holds the invariant netAmount === totalAmount − discountTotal', () => {
    const totals = computePlanTotals([
      { quantity: 3, unitPrice: 22000, discountType: 'percentage', discountValue: 10 },
      { quantity: 1, unitPrice: 8000 },
    ]);
    assert.equal(totals.totalAmount, 74000);
    assert.equal(totals.netAmount, 67400);
    assert.equal(totals.discountTotal, 6600);
    assert.equal(totals.netAmount, totals.totalAmount - totals.discountTotal);
  });

  it('excludes cancelled items from the quote', () => {
    const totals = computePlanTotals([
      { quantity: 1, unitPrice: 10000 },
      { quantity: 1, unitPrice: 50000, status: 'cancelled' },
    ]);
    assert.equal(totals.totalAmount, 10000);
    assert.equal(totals.netAmount, 10000);
  });

  it('is zero for an empty plan', () => {
    assert.deepEqual(computePlanTotals([]), {
      totalAmount: 0,
      discountTotal: 0,
      netAmount: 0,
    });
  });
});
