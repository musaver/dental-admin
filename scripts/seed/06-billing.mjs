/**
 * Invoices, their line items, and payments.
 *
 * Two sources of billing, because the clinic bills two ways: most invoices are
 * raised against a completed visit (what was actually done in the chair), and
 * a minority against an accepted treatment plan (agreed work, billed up front).
 * A deliberate backlog of completed-but-uninvoiced visits is left behind so the
 * "unbilled visits" worklist has something in it.
 *
 * The arithmetic here is the part that is checked, not assumed:
 *   totalAmount = Σ(line amounts), discount lines included as negatives
 *   paidAmount  = Σ(signed payments) for that invoice
 * Both are computed from the rows this module emits, never guessed.
 */
import {
  TODAY,
  at,
  chance,
  dateOnly,
  day,
  dt,
  int,
  isClinicDay,
  pick,
  pickN,
  plusDays,
  plusMinutes,
  shuffle,
  uuid,
  weighted,
} from './context.mjs';

const PLAN_SOURCE_STATUSES = ['accepted', 'in_progress', 'completed'];

/** Cash first — this is a Pakistani clinic, not a card-first market. */
const METHOD_WEIGHTS = [
  ['cash', 46],
  ['card', 21],
  ['bank_transfer', 14],
  ['easypaisa', 9],
  ['jazzcash', 7],
  ['cheque', 3],
];

const INVOICE_NOTES = [
  'Insurance claim pending — Jubilee',
  'Insurance claim pending — EFU Health',
  'Split billing with employer',
  'Itemised receipt issued for employer reimbursement',
];

const DISCOUNT_LABELS = [
  'Family discount',
  'Staff family discount',
  'Loyalty discount',
  'Corporate scheme discount',
];

/**
 * Earlier modules may register a datetime as a Date or as the naive string the
 * pool actually stores. Both have to come back as a Date to do arithmetic on.
 */
function asDate(value, fallback) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string' && value.length >= 10) {
    const trimmed = value.trim().replace(' ', 'T').replace(/Z$/, '');
    const iso = trimmed.length === 10 ? `${trimmed}T00:00:00Z` : `${trimmed}Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function toothCount(teeth) {
  if (!teeth) return 0;
  return String(teeth)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean).length;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

/** 'YYMM' — the period an invoice number resets on. */
function period(date) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

/** Midnight means the source carried a date only; give it a working hour. */
function billingTime(date) {
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) {
    return at(date, int(11, 18), pick([0, 10, 20, 30, 40, 50]));
  }
  return plusMinutes(date, int(20, 90));
}

/**
 * Split a total into `parts` payments that sum to exactly the total. The last
 * chunk is the remainder, so rounding never leaks a rupee.
 */
function splitAmount(total, parts) {
  if (parts <= 1 || total < parts * 1000) return [total];
  const chunks = [];
  let remaining = total;
  for (let i = 0; i < parts - 1; i += 1) {
    const partsLeft = parts - i;
    const reserve = (partsLeft - 1) * 1000;
    const ceiling = remaining - reserve;
    const target = roundTo((remaining * int(30, 60)) / 100, 500);
    const chunk = Math.max(1000, Math.min(ceiling, target));
    chunks.push(chunk);
    remaining -= chunk;
  }
  chunks.push(remaining);
  return chunks;
}

function transactionIdFor(method) {
  switch (method) {
    case 'card':
      return `AUTH${int(100000, 999999)}`;
    case 'bank_transfer':
      return `FT${int(10000000, 99999999)}`;
    case 'easypaisa':
      return `EP${int(100000000, 999999999)}`;
    case 'jazzcash':
      return `JC${int(100000000, 999999999)}`;
    case 'cheque':
      return `CHQ-${int(100000, 999999)}`;
    default:
      return null;
  }
}

export default function build(world, rows) {
  const registered = world.invoices || (world.invoices = []);
  const procedureById = new Map((world.procedures || []).map((p) => [p.id, p]));
  const patientById = new Map((world.patients || []).map((p) => [p.id, p]));
  const branchById = new Map((world.branches || []).map((b) => [b.id, b]));
  const allStaff = world.staff || [];
  const owners = allStaff.filter((s) => s.staffType === 'owner');

  const billerCache = new Map();
  /** Who raises paperwork at a branch: its receptionists, plus the owner. */
  function billersFor(branchId) {
    if (billerCache.has(branchId)) return billerCache.get(branchId);
    const local = allStaff.filter(
      (s) => s.branchId === branchId && s.staffType === 'receptionist' && s.isActive !== false
    );
    let pool = [...local, ...owners];
    if (!pool.length) pool = allStaff.filter((s) => s.isActive !== false);
    if (!pool.length) pool = allStaff;
    billerCache.set(branchId, pool);
    return pool;
  }

  function branchCodeFor(branchId) {
    return (branchById.get(branchId)?.code || 'MAIN').toUpperCase();
  }

  /**
   * The standing concession module 02 writes to `patients.defaultDiscountPercent`.
   * The world entity does not re-export that column, so read through to the row
   * it kept a handle on — reading `patient.defaultDiscountPercent` alone always
   * returns undefined and silently bills every concession patient in full.
   */
  function discountPercentFor(patientId) {
    const patient = patientById.get(patientId);
    return (
      Number(patient?.defaultDiscountPercent ?? patient?.row?.defaultDiscountPercent ?? 0) || 0
    );
  }

  const sequences = new Map();
  function allocateNumber(branchId, issue) {
    const code = branchCodeFor(branchId);
    const key = `${code}-${period(issue)}`;
    const seq = (sequences.get(key) || 0) + 1;
    sequences.set(key, seq);
    return `INV-${code}-${period(issue)}-${String(seq).padStart(5, '0')}`;
  }

  /* ── Draft the invoices ───────────────────────────────────────────── */

  const drafts = [];

  const completedVisits = (world.visits || []).filter(
    (v) => v.status === 'completed' && Array.isArray(v.procedures) && v.procedures.length > 0
  );
  const visitsOldestFirst = [...completedVisits].sort(
    (a, b) => asDate(a.visitDate, day(-60)).getTime() - asDate(b.visitDate, day(-60)).getTime()
  );

  // The backlog is mostly recent — work done this fortnight that reception has
  // not billed yet — with a few older stragglers that fell through.
  const recentPool = visitsOldestFirst.slice(-45);
  const olderPool = visitsOldestFirst.slice(0, -45);
  const unbilled = new Set([
    ...pickN(recentPool, Math.min(20, recentPool.length)).map((v) => v.id),
    ...pickN(olderPool, Math.min(5, olderPool.length)).map((v) => v.id),
  ]);

  // Everything except that backlog gets billed. A clinic that left two thirds of
  // its completed work uninvoiced would make the production and revenue reports
  // disagree wildly, which reads as a bug rather than as a backlog.
  for (const visit of visitsOldestFirst.filter((v) => !unbilled.has(v.id))) {
    const lines = [];
    for (const vp of visit.procedures) {
      const procedure = procedureById.get(vp.procedureId);
      const count = toothCount(vp.teeth);
      const quantity = procedure?.isPerTooth
        ? Math.max(1, count || Number(vp.quantity) || 1)
        : 1;
      const unitPrice = Math.round(Number(vp.price) || procedure?.defaultPrice || 0);
      if (unitPrice <= 0) continue;
      lines.push({
        procedureId: vp.procedureId,
        visitProcedureId: vp.id,
        treatmentPlanItemId: vp.treatmentPlanItemId || null,
        description: procedure?.name || 'Dental treatment',
        teeth: vp.teeth || null,
        quantity,
        unitPrice,
        discountAmount: 0,
        itemType: 'procedure',
      });
    }
    if (!lines.length) continue;

    let issue = billingTime(asDate(visit.visitDate, day(-30)));
    if (issue.getTime() > TODAY.getTime()) issue = plusMinutes(TODAY, -int(30, 120));

    drafts.push({
      patientId: visit.patientId,
      branchId:
        visit.branchId || patientById.get(visit.patientId)?.branchId || world.branches?.[0]?.id,
      visitId: visit.id,
      treatmentPlanId: null,
      issue,
      lines,
    });
  }

  // A plan invoice only carries items that have NOT been through a chair yet;
  // anything with a visitProcedureId is billed on that visit's invoice instead.
  const planCandidates = (world.plans || [])
    .filter((p) => PLAN_SOURCE_STATUSES.includes(p.status))
    .map((plan) => ({
      plan,
      items: (plan.items || []).filter((i) => i.status !== 'cancelled' && !i.visitProcedureId),
    }))
    .filter((c) => c.items.length > 0);

  let planInvoices = 0;
  for (const { plan, items } of shuffle(planCandidates)) {
    if (planInvoices >= 30) break;
    const lines = [];
    for (const item of items) {
      const procedure = procedureById.get(item.procedureId);
      const quantity = Math.max(
        1,
        Number(item.quantity) || toothCount(item.teeth) || 1
      );
      const unitPrice = Math.round(Number(item.unitPrice) || procedure?.defaultPrice || 0);
      if (unitPrice <= 0) continue;
      const gross = quantity * unitPrice;
      // The plan stores a polymorphic discountType/discountValue pair; an
      // invoice line stores a flat rupee amount. This is that conversion.
      const value = Number(item.discountValue) || 0;
      let discountAmount = 0;
      if (value > 0) {
        const raw =
          item.discountType === 'percentage' ? Math.round((gross * value) / 100) : Math.round(value);
        discountAmount = Math.max(0, Math.min(raw, gross));
      }
      lines.push({
        procedureId: item.procedureId,
        visitProcedureId: null,
        treatmentPlanItemId: item.id,
        description: procedure?.name || 'Planned treatment',
        teeth: item.teeth || null,
        quantity,
        unitPrice,
        discountAmount,
        itemType: 'procedure',
      });
    }
    if (!lines.length) continue;

    // Module 03 registers these as `acceptedAtDate` / `proposedAtDate` (Dates)
    // and leaves the naive strings on the row; `plan.acceptedAt` does not exist.
    const accepted = asDate(
      plan.acceptedAtDate || plan.row?.acceptedAt || plan.proposedAtDate || plan.row?.proposedAt,
      day(-int(14, 120))
    );
    let issue = billingTime(accepted);
    if (issue.getTime() > TODAY.getTime()) issue = plusMinutes(TODAY, -int(30, 120));

    planInvoices += 1;
    drafts.push({
      patientId: plan.patientId,
      branchId:
        plan.branchId || patientById.get(plan.patientId)?.branchId || world.branches?.[0]?.id,
      visitId: null,
      treatmentPlanId: plan.id,
      issue,
      lines,
    });
  }

  /* ── Patient-level discount lines ─────────────────────────────────── */

  // Module 02 gives a handful of patients a standing defaultDiscountPercent;
  // their invoices carry it as a single negative line, so the concession is
  // visible on the printed invoice rather than buried in the unit prices.
  const discountEligible = drafts.filter((d) => discountPercentFor(d.patientId) > 0);
  const discountTargets = discountEligible.length
    ? pickN(discountEligible, Math.min(12, discountEligible.length))
    : pickN(drafts, Math.min(12, drafts.length));

  for (const draft of discountTargets) {
    const gross = draft.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const percent = discountPercentFor(draft.patientId) || pick([10, 15, 20]);
    const magnitude = Math.round((gross * percent) / 100);
    if (magnitude <= 0) continue;
    draft.lines.push({
      procedureId: null,
      visitProcedureId: null,
      treatmentPlanItemId: null,
      description: `${pick(DISCOUNT_LABELS)} (${percent}%)`,
      teeth: null,
      quantity: 1,
      unitPrice: -magnitude,
      discountAmount: 0,
      itemType: 'discount',
    });
  }

  /* ── Totals, then numbering in issue order ────────────────────────── */

  for (const draft of drafts) {
    let subtotal = 0;
    let discountTotal = 0;
    let totalAmount = 0;
    for (const line of draft.lines) {
      if (line.itemType === 'discount') {
        line.amount = line.unitPrice;
        discountTotal += Math.abs(line.amount);
      } else {
        line.amount = line.quantity * line.unitPrice - line.discountAmount;
        subtotal += line.quantity * line.unitPrice;
        discountTotal += line.discountAmount;
      }
      totalAmount += line.amount;
    }
    draft.subtotal = subtotal;
    draft.discountTotal = discountTotal;
    draft.totalAmount = totalAmount;
    draft.dueDate = plusDays(draft.issue, 15);
  }

  const billable = drafts.filter((d) => d.totalAmount > 0);
  billable.sort((a, b) => a.issue.getTime() - b.issue.getTime());
  for (const draft of billable) {
    draft.id = uuid();
    draft.invoiceNumber = allocateNumber(draft.branchId, draft.issue);
  }

  /* ── Status mix ───────────────────────────────────────────────────── */

  const total = billable.length;
  const unpaidCount = Math.round(total * 0.11);
  const partialCount = Math.round(total * 0.22);

  const pool = shuffle(billable);
  function take(count, predicate) {
    const out = [];
    for (let i = 0; i < pool.length && out.length < count; ) {
      if (!predicate || predicate(pool[i])) out.push(pool.splice(i, 1)[0]);
      else i += 1;
    }
    return out;
  }

  // Overdue first: these are what the reminder job and the ageing report exist
  // for, so the dataset must contain some regardless of how the rest falls out.
  const overdue = take(5, (d) => d.dueDate.getTime() < day(0).getTime());
  // The rest are recent enough that they are not yet due — an unpaid invoice
  // from last week is ordinary, an unpaid one from last quarter is a problem.
  const recentUnpaid = take(
    Math.max(0, unpaidCount - overdue.length),
    (d) => d.issue.getTime() >= day(-13).getTime()
  );
  const unpaid = [...overdue, ...recentUnpaid];
  // Widen only if the recent window was too thin to fill the quota.
  unpaid.push(
    ...take(Math.max(0, unpaidCount - unpaid.length), (d) => d.issue.getTime() >= day(-35).getTime())
  );
  unpaid.push(...take(Math.max(0, unpaidCount - unpaid.length)));

  const refunded = take(2, (d) => d.totalAmount >= 5000);
  const waived = take(3);
  const partial = take(partialCount, (d) => d.totalAmount >= 2000);
  partial.push(...take(Math.max(0, partialCount - partial.length)));
  const paid = pool;

  for (const d of unpaid) d.status = 'unpaid';
  for (const d of refunded) d.status = 'refunded';
  for (const d of waived) d.status = 'waived';
  for (const d of partial) d.status = 'partial';
  for (const d of paid) d.status = 'paid';

  /* ── Payment dates ────────────────────────────────────────────────── */

  function settleDate(candidate, issue) {
    let out = candidate;
    if (!isClinicDay(out)) {
      const forward = at(plusDays(out, 1), int(10, 17), pick([0, 15, 30, 45]));
      const backward = at(plusDays(out, -1), int(10, 17), pick([0, 15, 30, 45]));
      if (forward.getTime() <= TODAY.getTime()) out = forward;
      else if (backward.getTime() >= issue.getTime()) out = backward;
    }
    if (out.getTime() > TODAY.getTime()) out = new Date(TODAY.getTime());
    if (out.getTime() < issue.getTime()) out = new Date(issue.getTime());
    return out;
  }

  /** Ascending payment dates, none before the invoice and none after today. */
  function paymentDates(issue, count) {
    const window = Math.max(0, Math.floor((TODAY.getTime() - issue.getTime()) / 86400000));
    const dates = [];
    let offset = chance(0.62) ? 0 : Math.min(window, int(1, 9));
    for (let i = 0; i < count; i += 1) {
      const candidate =
        offset <= 0
          ? plusMinutes(issue, int(5, 150))
          : at(plusDays(issue, offset), int(10, 18), pick([0, 15, 30, 45]));
      dates.push(settleDate(candidate, issue));
      offset = Math.min(window, offset + int(7, 30));
    }
    // Clamping to [issue, TODAY] can reorder an instalment against the one
    // before it — and a refund dated before the payment it reverses is a data
    // bug, not a rounding detail. Sorting makes the guarantee above true.
    dates.sort((a, b) => a.getTime() - b.getTime());
    return dates;
  }

  /* ── Emit ─────────────────────────────────────────────────────────── */

  let paymentRows = 0;

  function pushPayment(draft, { amount, type, method, paymentDate, notes = null }) {
    const chosen = method || weighted(METHOD_WEIGHTS);
    paymentRows += 1;
    rows.push('payments', {
      id: uuid(),
      patientId: draft.patientId,
      branchId: draft.branchId,
      invoiceId: draft.id,
      amount: Math.abs(Math.round(amount)),
      type,
      method: chosen,
      transactionId: transactionIdFor(chosen),
      paymentDate: dt(paymentDate),
      notes,
      recordedBy: pick(billersFor(draft.branchId)).id,
    });
  }

  for (const draft of billable) {
    const payments = [];

    if (draft.status === 'paid') {
      const parts = weighted([[1, 54], [2, 30], [3, 16]]);
      const amounts = splitAmount(draft.totalAmount, parts);
      const dates = paymentDates(draft.issue, amounts.length);
      amounts.forEach((amount, i) => payments.push({ amount, type: 'payment', at: dates[i] }));
    } else if (draft.status === 'partial') {
      const target = Math.max(
        1,
        Math.min(
          draft.totalAmount - 1,
          roundTo((draft.totalAmount * int(20, 80)) / 100, 500) || Math.floor(draft.totalAmount / 2)
        )
      );
      const parts = weighted([[1, 62], [2, 38]]);
      const amounts = splitAmount(target, parts);
      const dates = paymentDates(draft.issue, amounts.length);
      amounts.forEach((amount, i) => payments.push({ amount, type: 'payment', at: dates[i] }));
    } else if (draft.status === 'refunded') {
      const dates = paymentDates(draft.issue, 2);
      payments.push({ amount: draft.totalAmount, type: 'payment', at: dates[0] });
      payments.push({
        amount: draft.totalAmount,
        type: 'refund',
        at: dates[1],
        method: 'bank_transfer',
        notes: 'Refunded in full — treatment discontinued at patient request',
      });
    } else if (draft.status === 'waived' && chance(0.34)) {
      // A write-off can still have a part payment behind it; the status is a
      // decision about the remainder, not a statement that nothing was paid.
      const amount = Math.max(500, roundTo((draft.totalAmount * int(10, 30)) / 100, 500));
      payments.push({
        // Never below 1: payments.amount is always a positive integer.
        amount: Math.max(1, Math.min(amount, draft.totalAmount - 1)),
        type: 'payment',
        at: paymentDates(draft.issue, 1)[0],
      });
    }

    const paidAmount = payments.reduce(
      (sum, p) => sum + (p.type === 'refund' ? -p.amount : p.amount),
      0
    );

    let notes = null;
    if (draft.status === 'waived') {
      notes = pick([
        'Written off — hardship case, approved by the owner',
        'Written off — hardship case; balance not pursued',
      ]);
    } else if (chance(0.04)) {
      notes = pick(INVOICE_NOTES);
    }

    const row = rows.push('invoices', {
      id: draft.id,
      invoiceNumber: draft.invoiceNumber,
      patientId: draft.patientId,
      branchId: draft.branchId,
      visitId: draft.visitId,
      treatmentPlanId: draft.treatmentPlanId,
      issueDate: dt(draft.issue),
      dueDate: dateOnly(draft.dueDate),
      subtotal: draft.subtotal,
      discountTotal: draft.discountTotal,
      totalAmount: draft.totalAmount,
      paidAmount,
      status: draft.status,
      notes,
      createdBy: pick(billersFor(draft.branchId)).id,
      createdAt: dt(draft.issue),
      updatedAt: dt(payments.length ? payments[payments.length - 1].at : draft.issue),
    });

    for (const line of draft.lines) {
      rows.push('invoice_items', {
        id: uuid(),
        invoiceId: draft.id,
        procedureId: line.procedureId,
        visitProcedureId: line.visitProcedureId,
        treatmentPlanItemId: line.treatmentPlanItemId,
        description: line.description.slice(0, 255),
        teeth: line.teeth,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        amount: line.amount,
        itemType: line.itemType,
      });
    }

    for (const payment of payments) {
      pushPayment(draft, {
        amount: payment.amount,
        type: payment.type,
        method: payment.method,
        paymentDate: payment.at,
        notes: payment.notes || null,
      });
    }

    registered.push({
      id: draft.id,
      invoiceNumber: draft.invoiceNumber,
      patientId: draft.patientId,
      branchId: draft.branchId,
      visitId: draft.visitId,
      treatmentPlanId: draft.treatmentPlanId,
      totalAmount: draft.totalAmount,
      paidAmount,
      status: draft.status,
      row,
    });
  }

  /* ── Credit that belongs to no invoice ────────────────────────────── */

  // payments.invoiceId is nullable on purpose: a deposit taken before any
  // invoice exists, and the split-off part of an overpayment, are both real
  // money against the patient and neither can be found by walking invoices.
  const orthoPatients = [
    ...new Set(
      (world.plans || [])
        .filter((p) =>
          (p.items || []).some((i) => procedureById.get(i.procedureId)?.category === 'orthodontic')
        )
        .map((p) => p.patientId)
    ),
  ];
  // Ortho cases come first — a brace case is where a deposit is actually taken —
  // but the pool is TOPPED UP rather than swapped, so five deposits exist even
  // when only one plan happens to carry an orthodontic item.
  const orthoChosen = pickN(orthoPatients, Math.min(5, orthoPatients.length));
  const orthoTaken = new Set(orthoChosen);
  const otherPatients = (world.patients || []).map((p) => p.id).filter((id) => !orthoTaken.has(id));
  const advancePatients = [
    ...orthoChosen,
    ...pickN(otherPatients, Math.min(5 - orthoChosen.length, otherPatients.length)),
  ];

  for (const patientId of advancePatients) {
    const patient = patientById.get(patientId);
    const branchId = patient?.branchId || world.branches?.[0]?.id;
    const method = weighted([['cash', 40], ['bank_transfer', 35], ['card', 15], ['easypaisa', 10]]);
    paymentRows += 1;
    rows.push('payments', {
      id: uuid(),
      patientId,
      branchId,
      invoiceId: null,
      amount: pick([10000, 10000, 15000, 20000, 25000]),
      type: 'advance',
      method,
      transactionId: transactionIdFor(method),
      paymentDate: dt(settleDate(at(day(-int(3, 60)), int(11, 17), pick([0, 30])), day(-90))),
      notes: orthoTaken.has(patientId)
        ? 'Advance deposit taken before orthodontic treatment starts'
        : 'Advance deposit taken before treatment starts',
      recordedBy: pick(billersFor(branchId)).id,
    });
  }

  const overpayPool = (world.patients || []).map((p) => p.id);
  for (const patientId of pickN(overpayPool, Math.min(2, overpayPool.length))) {
    const patient = patientById.get(patientId);
    const branchId = patient?.branchId || world.branches?.[0]?.id;
    const method = weighted([['cash', 60], ['card', 40]]);
    paymentRows += 1;
    rows.push('payments', {
      id: uuid(),
      patientId,
      branchId,
      invoiceId: null,
      amount: roundTo(int(1000, 6000), 500) || 1000,
      type: 'payment',
      method,
      transactionId: transactionIdFor(method),
      paymentDate: dt(settleDate(at(day(-int(2, 45)), int(11, 18), pick([0, 15, 30])), day(-90))),
      notes: 'Overpayment split off the receipt and held as credit',
      recordedBy: pick(billersFor(branchId)).id,
    });
  }

  return { invoices: billable.length, payments: paymentRows };
}
