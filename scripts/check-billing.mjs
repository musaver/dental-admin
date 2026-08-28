/**
 * Exercises invoicing and payments against the live database.
 *
 * invoices.paidAmount and status are denormalised with nothing enforcing them,
 * payments.invoiceId is nullable so credit exists outside any invoice, and the
 * totals rule is the likeliest place for a silent money bug. All three are
 * checked here with real seeded prices, then cleaned up.
 *
 *   npm run check:billing
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import {
  computeInvoiceTotals,
  formatPKR,
  invoiceBalance,
  recomputeInvoiceStatus,
  signedAmount,
  sumPayments,
} from '../lib/money';
import { formatInvoiceNumber, invoicePeriod, parseInvoiceSequence } from '../lib/invoice-number';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  timezone: 'Z',
});

let failed = 0;
const check = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'ok   ' : 'FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const made = { patients: [], invoices: [], items: [], payments: [] };

/** Mirrors recomputeInvoice in lib/derive.ts. */
async function recompute(invoiceId) {
  const [[inv]] = await conn.query('SELECT totalAmount, status FROM invoices WHERE id = ?', [invoiceId]);
  const [rows] = await conn.query('SELECT type, amount FROM payments WHERE invoiceId = ?', [invoiceId]);
  const paidAmount = sumPayments(rows);
  const status = recomputeInvoiceStatus({
    totalAmount: inv.totalAmount,
    paidAmount,
    currentStatus: inv.status,
    hasRefunds: rows.some((r) => r.type === 'refund'),
  });
  await conn.query('UPDATE invoices SET paidAmount = ?, status = ? WHERE id = ?', [paidAmount, status, invoiceId]);
  return { paidAmount, status };
}

try {
  const [[branch]] = await conn.query('SELECT id, code FROM branches LIMIT 1');
  const [[staff]] = await conn.query('SELECT id FROM admin_users LIMIT 1');
  const [[rct]] = await conn.query("SELECT id, name, defaultPrice FROM procedures WHERE code='END-03'");
  const [[consult]] = await conn.query("SELECT id, name, defaultPrice FROM procedures WHERE code='CON-01'");
  console.log(`${rct.name} ${formatPKR(rct.defaultPrice)} · ${consult.name} ${formatPKR(consult.defaultPrice)}\n`);

  const patientId = randomUUID();
  made.patients.push(patientId);
  await conn.query(
    `INSERT INTO patients (id, mrn, branchId, firstName, phone, status, defaultDiscountPercent, createdAt, updatedAt)
     VALUES (?,?,?,?,?,'active',10,NOW(),NOW())`,
    [patientId, `ZZB-${Date.now() % 1000000}`, branch.id, 'BillingCheck', '+923000000004']
  );

  /* Invoice numbering -------------------------------------------------- */

  const period = invoicePeriod(new Date());
  const prefix = `INV-${branch.code}-${period}-`;
  const [[last]] = await conn.query(
    'SELECT invoiceNumber FROM invoices WHERE invoiceNumber LIKE ? ORDER BY invoiceNumber DESC LIMIT 1',
    [`${prefix}%`]
  );
  const seq = last ? parseInvoiceSequence(last.invoiceNumber) + 1 : 1;
  const invoiceNumber = formatInvoiceNumber(branch.code, period, seq);

  check('invoice number carries branch and month', invoiceNumber.startsWith(prefix), invoiceNumber);
  check('invoice number fits varchar(30)', invoiceNumber.length <= 30);

  /* Totals: a per-tooth line plus a patient discount line -------------- */

  const lines = [
    { quantity: 3, unitPrice: rct.defaultPrice, discountAmount: 0, itemType: 'procedure',
      amount: 3 * rct.defaultPrice },
    { quantity: 1, unitPrice: consult.defaultPrice, discountAmount: 0, itemType: 'procedure',
      amount: consult.defaultPrice },
  ];
  const gross = lines.reduce((s, l) => s + l.amount, 0);
  const discount = Math.round(gross * 0.1);
  lines.push({ quantity: 1, unitPrice: -discount, discountAmount: 0, itemType: 'discount', amount: -discount });

  const totals = computeInvoiceTotals(lines);
  check(
    'the discount line is counted once, not twice',
    totals.subtotal === gross && totals.discountTotal === discount && totals.totalAmount === gross - discount,
    `${formatPKR(gross)} − ${formatPKR(discount)} = ${formatPKR(totals.totalAmount)}`
  );
  check(
    'header total equals the sum of the lines',
    totals.totalAmount === lines.reduce((s, l) => s + l.amount, 0)
  );

  const invoiceId = randomUUID();
  made.invoices.push(invoiceId);
  await conn.query(
    `INSERT INTO invoices (id, invoiceNumber, patientId, branchId, issueDate, subtotal,
                           discountTotal, totalAmount, paidAmount, status, createdBy, createdAt, updatedAt)
     VALUES (?,?,?,?,NOW(),?,?,?,0,'unpaid',?,NOW(),NOW())`,
    [invoiceId, invoiceNumber, patientId, branch.id, totals.subtotal, totals.discountTotal, totals.totalAmount, staff.id]
  );
  for (const line of lines) {
    const id = randomUUID();
    made.items.push(id);
    await conn.query(
      `INSERT INTO invoice_items (id, invoiceId, description, quantity, unitPrice,
                                  discountAmount, amount, itemType, createdAt)
       VALUES (?,?,?,?,?,?,?,?,NOW())`,
      [id, invoiceId, 'Line', line.quantity, line.unitPrice, line.discountAmount, line.amount, line.itemType]
    );
  }

  /* The unique index is the real guard against a numbering race -------- */

  let rejected = false;
  try {
    await conn.query(
      `INSERT INTO invoices (id, invoiceNumber, patientId, branchId, subtotal, totalAmount,
                             status, createdBy, createdAt, updatedAt)
       VALUES (?,?,?,?,0,0,'unpaid',?,NOW(),NOW())`,
      [randomUUID(), invoiceNumber, patientId, branch.id, staff.id]
    );
  } catch (e) { rejected = e.errno === 1062; }
  check('the database refuses a duplicate invoice number', rejected);

  /* Partial payment ---------------------------------------------------- */

  const part = Math.round(totals.totalAmount / 3);
  const p1 = randomUUID(); made.payments.push(p1);
  await conn.query(
    `INSERT INTO payments (id, patientId, branchId, invoiceId, amount, type, method,
                           paymentDate, recordedBy, createdAt)
     VALUES (?,?,?,?,?,'payment','cash',NOW(),?,NOW())`,
    [p1, patientId, branch.id, invoiceId, part, staff.id]
  );
  let state = await recompute(invoiceId);
  check('a partial payment reads as partial', state.status === 'partial', formatPKR(state.paidAmount));

  /* Overpayment must split, not overpay the invoice -------------------- */

  const balance = invoiceBalance({ totalAmount: totals.totalAmount, paidAmount: state.paidAmount });
  const handedOver = balance + 5000;

  const p2 = randomUUID(); made.payments.push(p2);
  await conn.query(
    `INSERT INTO payments (id, patientId, branchId, invoiceId, amount, type, method,
                           paymentDate, recordedBy, createdAt)
     VALUES (?,?,?,?,?,'payment','cash',NOW(),?,NOW())`,
    [p2, patientId, branch.id, invoiceId, balance, staff.id]
  );
  const p3 = randomUUID(); made.payments.push(p3);
  await conn.query(
    `INSERT INTO payments (id, patientId, branchId, invoiceId, amount, type, method,
                           paymentDate, recordedBy, createdAt)
     VALUES (?,?,?,NULL,?,'payment','cash',NOW(),?,NOW())`,
    [p3, patientId, branch.id, handedOver - balance, staff.id]
  );

  state = await recompute(invoiceId);
  check('the invoice settles exactly', state.status === 'paid' && state.paidAmount === totals.totalAmount,
    formatPKR(state.paidAmount));

  const [credits] = await conn.query(
    'SELECT type, amount FROM payments WHERE patientId = ? AND invoiceId IS NULL', [patientId]
  );
  const credit = sumPayments(credits);
  check('the excess becomes credit on account, not an overpaid invoice', credit === 5000, formatPKR(credit));

  /* The ledger must union invoices AND payments ------------------------ */

  const [[inv]] = await conn.query('SELECT totalAmount, paidAmount FROM invoices WHERE id = ?', [invoiceId]);
  const outstanding = inv.totalAmount - inv.paidAmount;
  check(
    'walking invoices alone would miss the credit',
    outstanding === 0 && outstanding - credit === -5000,
    `outstanding ${formatPKR(outstanding)}, net ${formatPKR(outstanding - credit)}`
  );

  /* Refund -------------------------------------------------------------- */

  const p4 = randomUUID(); made.payments.push(p4);
  await conn.query(
    `INSERT INTO payments (id, patientId, branchId, invoiceId, amount, type, method,
                           paymentDate, recordedBy, createdAt)
     VALUES (?,?,?,?,?,'refund','cash',NOW(),?,NOW())`,
    [p4, patientId, branch.id, invoiceId, totals.totalAmount, staff.id]
  );
  state = await recompute(invoiceId);
  check(
    'a fully refunded invoice reads refunded, not unpaid',
    state.status === 'refunded',
    `${state.status}, paid ${formatPKR(state.paidAmount)}`
  );
  check('refunds subtract rather than add', state.paidAmount === 0);

  /* Waived stays waived ------------------------------------------------- */

  await conn.query("UPDATE invoices SET status = 'waived' WHERE id = ?", [invoiceId]);
  const p5 = randomUUID(); made.payments.push(p5);
  await conn.query(
    `INSERT INTO payments (id, patientId, branchId, invoiceId, amount, type, method,
                           paymentDate, recordedBy, createdAt)
     VALUES (?,?,?,?,1000,'payment','cash',NOW(),?,NOW())`,
    [p5, patientId, branch.id, invoiceId, staff.id]
  );
  state = await recompute(invoiceId);
  check('a waived invoice stays waived when money later arrives', state.status === 'waived');
} finally {
  const order = [
    ['payments', made.payments],
    ['invoice_items', made.items],
    ['invoices', made.invoices],
    ['patients', made.patients],
  ];
  for (const [table, ids] of order) {
    if (!ids.length) continue;
    await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  console.log('\nCleaned up the billing test data.');
  await conn.end();
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nBilling behaves correctly.');
