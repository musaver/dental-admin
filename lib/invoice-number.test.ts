import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatInvoiceNumber,
  invoiceNumberPrefix,
  invoicePeriod,
  nextInvoiceNumber,
  parseInvoiceSequence,
} from './invoice-number.ts';
import { fromClinicParts } from './datetime.ts';

const august = fromClinicParts(2026, 8, 28);

describe('invoicePeriod', () => {
  it('is YYMM', () => {
    assert.equal(invoicePeriod(august), '2608');
    assert.equal(invoicePeriod(fromClinicParts(2027, 1, 1)), '2701');
    assert.equal(invoicePeriod(fromClinicParts(2026, 12, 31)), '2612');
  });
});

describe('formatInvoiceNumber', () => {
  it('builds the documented shape', () => {
    assert.equal(formatInvoiceNumber('MAIN', '2608', 42), 'INV-MAIN-2608-00042');
  });

  it('upper-cases the branch code', () => {
    assert.equal(formatInvoiceNumber('main', '2608', 1), 'INV-MAIN-2608-00001');
  });

  it('fits varchar(30) at the worst case', () => {
    // branches.code is varchar(10).
    assert.ok(formatInvoiceNumber('ABCDEFGHIJ', '2608', 99999).length <= 30);
  });
});

describe('sequence ordering', () => {
  it('sorts lexicographically in numeric order', () => {
    // This is why the padding exists: ORDER BY invoiceNumber DESC on the
    // unique index finds the highest number without scanning the table.
    const numbers = [
      formatInvoiceNumber('MAIN', '2608', 2),
      formatInvoiceNumber('MAIN', '2608', 10),
      formatInvoiceNumber('MAIN', '2608', 1),
    ];
    assert.deepEqual([...numbers].sort(), [
      'INV-MAIN-2608-00001',
      'INV-MAIN-2608-00002',
      'INV-MAIN-2608-00010',
    ]);
  });

  it('round-trips through parseInvoiceSequence', () => {
    for (const n of [1, 42, 99999]) {
      assert.equal(parseInvoiceSequence(formatInvoiceNumber('MAIN', '2608', n)), n);
    }
  });

  it('returns 0 for anything that is not an invoice number', () => {
    assert.equal(parseInvoiceSequence('not-a-number'), 0);
    assert.equal(parseInvoiceSequence(''), 0);
  });
});

describe('nextInvoiceNumber', () => {
  it('starts at 1 for the first invoice of a branch-month', () => {
    assert.equal(nextInvoiceNumber('MAIN', august, null), 'INV-MAIN-2608-00001');
    assert.equal(nextInvoiceNumber('MAIN', august, undefined), 'INV-MAIN-2608-00001');
  });

  it('increments from the previous number', () => {
    assert.equal(
      nextInvoiceNumber('MAIN', august, 'INV-MAIN-2608-00041'),
      'INV-MAIN-2608-00042'
    );
  });

  it('resets the sequence in a new month', () => {
    // September asks for September's last number, which is null on day one.
    const september = fromClinicParts(2026, 9, 1);
    assert.equal(nextInvoiceNumber('MAIN', september, null), 'INV-MAIN-2609-00001');
  });

  it('keeps branches independent', () => {
    // Two clinics issuing at the same moment produce different numbers.
    assert.equal(nextInvoiceNumber('MAIN', august, null), 'INV-MAIN-2608-00001');
    assert.equal(nextInvoiceNumber('CLFT', august, null), 'INV-CLFT-2608-00001');
  });

  it('refuses to wrap when the monthly range is exhausted', () => {
    assert.throws(
      () => nextInvoiceNumber('MAIN', august, 'INV-MAIN-2608-99999'),
      /exhausting/
    );
  });
});

describe('invoiceNumberPrefix', () => {
  it('selects exactly one branch-month', () => {
    const prefix = invoiceNumberPrefix('MAIN', '2608');
    assert.equal(prefix, 'INV-MAIN-2608-');
    assert.ok(formatInvoiceNumber('MAIN', '2608', 1).startsWith(prefix));
    // Not another month, and not another branch.
    assert.ok(!formatInvoiceNumber('MAIN', '2609', 1).startsWith(prefix));
    assert.ok(!formatInvoiceNumber('CLFT', '2608', 1).startsWith(prefix));
  });
});
