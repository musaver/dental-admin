/**
 * Treatment plans and their line items.
 *
 * One plan per patient, so no patient ever has two open plans. Statuses are
 * spread deliberately rather than randomly: the acceptance-rate report needs a
 * stable ratio of proposed to accepted, and the in-progress plans are what
 * modules 04 and 05 hang appointments and visits off.
 *
 * Item money is computed exactly as lib/money.ts computes it, and the plan
 * rollups are summed from the items, so check-invariants passes by
 * construction. A cancelled item is excluded from all three plan totals.
 */
import {
  uuid,
  int,
  pick,
  pickN,
  chance,
  weighted,
  day,
  at,
  plusDays,
  plusMinutes,
  nextClinicDay,
  TODAY,
  dt,
  packTeeth,
  surfacesFor,
  PERMANENT_TEETH,
} from './context.mjs';

/* ── Tooth pools ──────────────────────────────────────────────────────── */

/** Molars and premolars of one FDI quadrant, third molars excluded. */
function quadrantPosteriors(quadrant) {
  return PERMANENT_TEETH.filter(
    (t) => t[0] === String(quadrant) && Number(t[1]) >= 4 && t[1] !== '8'
  );
}

const UPPER_ANTERIORS = PERMANENT_TEETH.filter(
  (t) => (t[0] === '1' || t[0] === '2') && Number(t[1]) <= 3
);
const THIRD_MOLARS = PERMANENT_TEETH.filter((t) => t[1] === '8');

/** n teeth from a pool, in arch order so the CSV reads like a chart entry. */
function teethFrom(pool, n) {
  return pickN(pool, n).sort((a, b) => Number(a) - Number(b));
}

/* ── Plan blueprints ──────────────────────────────────────────────────── */

/**
 * Each blueprint yields item specs; a spec's `teeth` is honoured only when the
 * procedure is actually per-tooth. Titles that name a tooth pin that tooth, so
 * the title and the line always agree.
 */
const BLUEPRINTS = [
  {
    title: 'Full-mouth rehabilitation',
    // The one negotiated package: a single large fixed discount off the total.
    package: true,
    notes: 'Phased over three visits. Patient wants the upper arch finished first.',
    items: () => [
      { code: 'SC-01' },
      { code: 'XR-02' },
      { code: 'RES-02', teeth: teethFrom(quadrantPosteriors(1), 2) },
      { code: 'END-03', teeth: teethFrom(quadrantPosteriors(3).filter((t) => t[1] === '6'), 1) },
      { code: 'PRO-02', teeth: teethFrom(quadrantPosteriors(2), 2), note: 'Lab: shade A2' },
    ],
  },
  {
    title: 'RCT and crown — 46',
    items: () => [
      { code: 'END-03', teeth: ['46'] },
      { code: 'PRO-01', teeth: ['46'], note: 'Crown fit two weeks after obturation' },
    ],
  },
  {
    title: 'Upper anterior aesthetics',
    items: () => [{ code: 'COS-01' }, { code: 'RES-01', teeth: teethFrom(UPPER_ANTERIORS, 2) }],
  },
  {
    title: 'Ortho — fixed braces (18 months)',
    notes: 'Monthly adjustments quoted separately after the first six months.',
    items: () => [{ code: 'XR-02' }, { code: 'ORT-02' }, { code: 'ORT-03' }],
  },
  {
    title: 'Quadrant restorations — lower right',
    items: () => [
      { code: 'RES-02', teeth: teethFrom(quadrantPosteriors(4), 2) },
      { code: 'RES-01', teeth: teethFrom(quadrantPosteriors(4), 1) },
    ],
  },
  {
    title: 'Wisdom teeth — surgical removal',
    notes: 'Both lower thirds impacted; referred for OPG before booking.',
    items: () => [{ code: 'XR-02' }, { code: 'SUR-03', teeth: teethFrom(THIRD_MOLARS, 2) }],
  },
  {
    title: 'Implant — lower left first molar',
    items: () => [
      { code: 'XR-02' },
      { code: 'SUR-01', teeth: ['36'] },
      { code: 'IMP-01', teeth: ['36'], note: 'Three months healing before loading' },
    ],
  },
  {
    title: 'Scaling and review',
    items: () => [{ code: 'SC-01' }, { code: 'CON-01' }],
  },
  {
    title: 'Quadrant restorations — upper right',
    items: () => [
      { code: 'RES-01', teeth: teethFrom(quadrantPosteriors(1), 1) },
      { code: 'RES-02', teeth: teethFrom(quadrantPosteriors(1), 2) },
    ],
  },
  {
    title: 'Crown replacement — 16',
    items: () => [
      { code: 'XR-01', teeth: ['16'] },
      { code: 'PRO-01', teeth: ['16'], note: 'Existing PFM fractured at the margin' },
    ],
  },
  {
    title: 'Whitening and composite bonding',
    items: () => [{ code: 'COS-01' }, { code: 'RES-01', teeth: teethFrom(UPPER_ANTERIORS, 1) }],
  },
  {
    title: 'RCT and crown — upper premolar',
    items: () => [
      { code: 'XR-01', teeth: ['25'] },
      { code: 'END-02', teeth: ['25'] },
      { code: 'PRO-01', teeth: ['25'] },
    ],
  },
  {
    title: 'Anterior RCT and crown — 21',
    notes: 'Discoloured after trauma. Patient asked for zirconia.',
    items: () => [
      { code: 'END-01', teeth: ['21'] },
      { code: 'PRO-02', teeth: ['21'] },
    ],
  },
  {
    title: 'Extraction and space review',
    items: () => [
      { code: 'SUR-01', teeth: teethFrom(quadrantPosteriors(3), 1) },
      { code: 'CON-01' },
    ],
  },
  {
    title: 'Periodontal maintenance',
    items: () => [{ code: 'SC-01' }, { code: 'CON-01' }],
  },
  {
    title: 'Composite restorations — lower left',
    items: () => [{ code: 'RES-02', teeth: teethFrom(quadrantPosteriors(3), 2) }],
  },
  {
    title: 'Two molar root canals',
    items: () => [
      { code: 'END-03', teeth: teethFrom(quadrantPosteriors(4).filter((t) => Number(t[1]) >= 6), 2) },
      { code: 'PRO-01', teeth: teethFrom(quadrantPosteriors(4).filter((t) => Number(t[1]) >= 6), 2) },
    ],
  },
  {
    title: 'Ortho assessment and records',
    items: () => [{ code: 'CON-01' }, { code: 'XR-02' }],
  },
  {
    title: 'Zirconia crowns — upper anteriors',
    items: () => [{ code: 'PRO-02', teeth: teethFrom(UPPER_ANTERIORS, 2) }],
  },
  {
    title: 'Emergency extraction and follow-up',
    items: () => {
      const tooth = pick(quadrantPosteriors(2));
      return [
        { code: 'XR-01', teeth: [tooth] },
        { code: 'SUR-01', teeth: [tooth] },
      ];
    },
  },
  {
    title: 'Multiple restorations — upper arch',
    items: () => [
      { code: 'RES-01', teeth: teethFrom(quadrantPosteriors(1), 2) },
      { code: 'RES-02', teeth: teethFrom(quadrantPosteriors(2), 2) },
    ],
  },
  {
    title: 'Crown and core — 47',
    items: () => [
      { code: 'END-03', teeth: ['47'] },
      { code: 'PRO-01', teeth: ['47'] },
    ],
  },
  {
    title: 'Composite repair — upper left',
    items: () => [{ code: 'RES-01', teeth: teethFrom(quadrantPosteriors(2), 1) }],
  },
  {
    title: 'Scaling, x-rays and restorations',
    items: () => [
      { code: 'SC-01' },
      { code: 'XR-02' },
      { code: 'RES-02', teeth: teethFrom(quadrantPosteriors(4), 2) },
    ],
  },
  {
    title: 'Implant — upper right premolar',
    notes: 'Quoted at the consultation; patient comparing prices.',
    items: () => [
      { code: 'IMP-01', teeth: ['15'] },
      { code: 'PRO-02', teeth: ['15'] },
    ],
  },
  {
    title: 'Consultation and treatment options',
    items: () => [{ code: 'CON-01' }, { code: 'XR-02' }],
  },
];

/**
 * Which blueprint carries which status. Fixed rather than random because the
 * in-progress and completed plans need at least two items to split, and the
 * report ratios should not move between runs.
 */
const STATUS_BY_INDEX = new Map([
  [0, 'in_progress'], [3, 'in_progress'], [6, 'in_progress'],
  [11, 'in_progress'], [16, 'in_progress'], [23, 'in_progress'],
  [1, 'completed'], [12, 'completed'], [21, 'completed'],
  [4, 'accepted'], [5, 'accepted'], [9, 'accepted'],
  [19, 'accepted'], [20, 'accepted'], [24, 'accepted'],
  [2, 'proposed'], [8, 'proposed'], [10, 'proposed'], [17, 'proposed'], [25, 'proposed'],
  [7, 'draft'], [14, 'draft'], [15, 'draft'], [22, 'draft'],
  [13, 'rejected'], [18, 'rejected'],
]);

/**
 * In-progress plans that also carry one abandoned line — the classic "had the
 * root canal, never came back for the crown". Never the package plan (0): its
 * whole negotiated discount hangs on one line, and cancelling that line would
 * drop the discount out of every plan total.
 */
const CANCELS_AN_ITEM = new Set([11, 23]);

/** How far back a plan of each status was first written up. */
const CREATED_WINDOW = {
  completed: [-175, -80],
  in_progress: [-150, -40],
  accepted: [-95, -12],
  rejected: [-120, -18],
  proposed: [-38, -4],
  draft: [-45, -2],
};

/** Oldest patients first, so long histories land on long-registered people. */
const FILL_ORDER = ['completed', 'in_progress', 'accepted', 'rejected', 'proposed', 'draft'];

const ACCEPTED_NOTES = [
  'Agreed on WhatsApp',
  'Signed consent at the front desk',
  'Agreed in person, husband present',
  'Confirmed by phone, deposit taken',
];

const REJECT_REASONS = [
  'Cost — will reconsider after Ramadan',
  'Wants a second opinion on the extraction',
];

/* ── Helpers ──────────────────────────────────────────────────────────── */

function registeredOn(patient) {
  const value = patient.createdAtDate ?? patient.createdAt ?? null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(`${value.replace(' ', 'T')}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Unknown registration date: treat the patient as long-standing rather than
  // silently dropping them from every plan.
  return day(-400);
}

function workingMoment(date) {
  return at(nextClinicDay(date), int(10, 17), pick([0, 15, 30, 45]));
}

/**
 * A clinic-hours moment strictly after `base`, minDays to maxDays later, and
 * never later than the anchor "now" — a plan cannot have been accepted
 * tomorrow. The late edge of CREATED_WINDOW plus the registration clamp can
 * otherwise push acceptedAt several days into the future.
 */
function after(base, minDays, maxDays) {
  const candidate = workingMoment(plusDays(base, int(minDays, maxDays)));
  const moment =
    candidate.getTime() > base.getTime() ? candidate : plusMinutes(base, int(20, 120));
  if (moment.getTime() <= TODAY.getTime()) return moment;
  // Landed past "now": take whatever room is left between `base` and the anchor.
  const room = Math.floor((TODAY.getTime() - base.getTime()) / 60_000);
  if (room <= 0) return base;
  return plusMinutes(base, int(Math.min(20, room), room));
}

/** Quoted prices drift off the list price by up to a tenth, rounded to 100. */
function quotedPrice(defaultPrice) {
  if (!chance(0.22)) return defaultPrice;
  const shifted = defaultPrice + (defaultPrice * int(-10, 10)) / 100;
  return Math.max(100, Math.round(shifted / 100) * 100);
}

function discountFor() {
  if (!chance(0.32)) return { discountType: null, discountValue: 0 };
  if (weighted([['percentage', 8], ['fixed', 2]]) === 'fixed') {
    return { discountType: 'fixed', discountValue: 2000 };
  }
  return { discountType: 'percentage', discountValue: pick([10, 10, 15]) };
}

function discountAmount(gross, type, value) {
  if (!type || value <= 0) return 0;
  const raw = type === 'percentage' ? Math.round((gross * value) / 100) : Math.round(value);
  return Math.max(0, Math.min(raw, gross));
}

/* ── Build ────────────────────────────────────────────────────────────── */

export default function build(world, rows) {
  if (!world.plans) world.plans = [];
  const procedureByCode = new Map(world.procedures.map((p) => [p.code, p]));

  const clinical = world.staff.filter(
    (s) => s.isClinical && s.isActive !== false && s.staffType !== 'assistant'
  );
  const dentists = clinical.length ? clinical : world.staff;

  const eligible = world.patients
    .filter((p) => !p.isChild)
    .filter((p) => {
      // world.patients carries the patients row rather than a flattened
      // status, so reading only `p.status` matched nothing and quoted
      // treatment to archived people.
      const patientStatus = p.status ?? p.row?.status ?? 'active';
      return patientStatus !== 'archived' && patientStatus !== 'deceased';
    })
    .filter((p) => registeredOn(p).getTime() <= day(-14).getTime())
    .sort(
      (a, b) =>
        registeredOn(a) - registeredOn(b) || String(a.mrn).localeCompare(String(b.mrn))
    );

  // Three tiers by how long the patient has been on the books; the buckets that
  // need a long history draw from the oldest tier.
  const oldEnd = Math.ceil(eligible.length * 0.4);
  const midEnd = Math.ceil(eligible.length * 0.75);
  const tiers = {
    long: eligible.slice(0, oldEnd),
    mid: eligible.slice(oldEnd, midEnd),
    recent: eligible.slice(midEnd),
  };
  const TIER_FOR_STATUS = {
    completed: 'long',
    in_progress: 'long',
    accepted: 'mid',
    rejected: 'mid',
    proposed: 'recent',
    draft: 'recent',
  };

  const used = new Set();
  function drawPatient(status) {
    const preferred = tiers[TIER_FOR_STATUS[status]].filter((p) => !used.has(p.id));
    const pool = preferred.length ? preferred : eligible.filter((p) => !used.has(p.id));
    if (!pool.length) return null;
    const patient = pickN(pool, 1)[0];
    used.add(patient.id);
    return patient;
  }

  // Blueprints grouped by the status they were assigned, walked in fill order.
  const order = [];
  for (const status of FILL_ORDER) {
    for (const [index, assigned] of STATUS_BY_INDEX) {
      if (assigned === status) order.push({ index, status });
    }
  }

  for (const { index, status } of order) {
    const blueprint = BLUEPRINTS[index];
    const patient = drawPatient(status);
    if (!patient) continue;

    const branchDentists = dentists.filter(
      (d) => !d.branchId || d.branchId === patient.branchId
    );
    const dentist = pick(branchDentists.length ? branchDentists : dentists);

    const planId = uuid();

    /* Lines: price, teeth, surfaces. */
    const built = [];
    for (const spec of blueprint.items()) {
      const procedure = procedureByCode.get(spec.code);
      if (!procedure) continue;

      const perTooth = Boolean(procedure.isPerTooth);
      const teeth = perTooth && spec.teeth && spec.teeth.length ? spec.teeth : null;
      const quantity = teeth ? teeth.length : 1;
      const unitPrice = quotedPrice(procedure.defaultPrice);
      const restorative = procedure.category === 'restorative';

      built.push({
        procedure,
        teeth,
        // Surfaces only make sense on a filling of one identified tooth.
        surfaces: restorative && teeth && teeth.length === 1 ? surfacesFor(teeth[0]) : null,
        quantity,
        unitPrice,
        gross: quantity * unitPrice,
        discountType: null,
        discountValue: 0,
        note: spec.note ?? null,
      });
    }
    if (!built.length) continue;

    /* Line statuses. Settled before the discounts, because a cancelled line
       leaves every plan total — so it must never be the line a negotiated
       package discount is hung on. */
    let lineStatuses = built.map(() => 'pending');
    if (status === 'completed') {
      lineStatuses = built.map(() => 'completed');
    } else if (status === 'in_progress') {
      const cancelLast = CANCELS_AN_ITEM.has(index) && built.length >= 3;
      const activeCount = cancelLast ? built.length - 1 : built.length;
      const doneCount = int(1, Math.max(1, activeCount - 1));
      lineStatuses = built.map((_, i) => {
        if (cancelLast && i === built.length - 1) return 'cancelled';
        return i < doneCount ? 'completed' : 'pending';
      });
    }

    if (blueprint.package) {
      const quoted = built.filter((_, i) => lineStatuses[i] !== 'cancelled');
      const biggest = quoted.reduce(
        (best, item) => (item.gross > best.gross ? item : best),
        quoted[0]
      );
      biggest.discountType = 'fixed';
      biggest.discountValue = 25000;
    } else {
      for (const item of built) Object.assign(item, discountFor());
    }

    for (const item of built) {
      item.discount = discountAmount(item.gross, item.discountType, item.discountValue);
      item.netAmount = item.gross - item.discount;
    }

    /* Plan rollups, over non-cancelled lines only. */
    let totalAmount = 0;
    let discountTotal = 0;
    let netAmount = 0;
    built.forEach((item, i) => {
      if (lineStatuses[i] === 'cancelled') return;
      totalAmount += item.gross;
      discountTotal += item.discount;
      netAmount += item.netAmount;
    });

    /* Timestamps, never earlier than the patient's registration. */
    const [lo, hi] = CREATED_WINDOW[status];
    const registration = registeredOn(patient);
    let createdAt = workingMoment(day(int(lo, hi)));
    if (createdAt.getTime() < registration.getTime()) {
      // At least the next day: workingMoment lands at 10:00-17:45, and patients
      // register as late as 18:00, so a same-day retry can precede registration.
      createdAt = workingMoment(plusDays(registration, int(1, 6)));
    }

    const proposesPlan = status !== 'draft';
    const proposedAt = proposesPlan ? after(createdAt, 0, 3) : null;
    const acceptsPlan = status === 'accepted' || status === 'in_progress' || status === 'completed';
    const acceptedAt = acceptsPlan ? after(proposedAt, 0, 9) : null;
    const updatedAt = acceptedAt ?? proposedAt ?? createdAt;

    const planRow = rows.push('treatment_plans', {
      id: planId,
      patientId: patient.id,
      branchId: patient.branchId,
      dentistId: dentist.id,
      title: blueprint.title,
      status,
      totalAmount,
      discountTotal,
      netAmount,
      proposedAt: dt(proposedAt),
      acceptedAt: dt(acceptedAt),
      acceptedNote: acceptedAt ? pick(ACCEPTED_NOTES) : null,
      consentFileId: null,
      cancelReason: status === 'rejected' ? pick(REJECT_REASONS) : null,
      notes: blueprint.notes ?? null,
      createdAt: dt(createdAt),
      updatedAt: dt(updatedAt),
    });

    const items = built.map((item, i) => {
      const itemRow = rows.push('treatment_plan_items', {
        id: uuid(),
        treatmentPlanId: planId,
        procedureId: item.procedure.id,
        teeth: item.teeth ? packTeeth(item.teeth) : null,
        surfaces: item.surfaces,
        toothConditionId: null,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        discountType: item.discountType,
        discountValue: item.discountValue,
        netAmount: item.netAmount,
        status: lineStatuses[i],
        // Modules 04 and 05 fill these in and set the matching back-pointer.
        appointmentId: null,
        visitProcedureId: null,
        sortOrder: i,
        notes: item.note,
        // Left to the column DEFAULT these would be the wall-clock time of the
        // seed run, which breaks the re-runnable-to-identical-data guarantee
        // and dates a May line item to today.
        createdAt: dt(createdAt),
        updatedAt: dt(updatedAt),
      });

      return {
        id: itemRow.id,
        procedureId: item.procedure.id,
        procedureCode: item.procedure.code,
        teeth: itemRow.teeth,
        surfaces: item.surfaces,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountType: item.discountType,
        discountValue: item.discountValue,
        netAmount: item.netAmount,
        status: lineStatuses[i],
        appointmentId: null,
        visitProcedureId: null,
        row: itemRow,
      };
    });

    world.plans.push({
      id: planId,
      patientId: patient.id,
      branchId: patient.branchId,
      dentistId: dentist.id,
      title: blueprint.title,
      status,
      totalAmount,
      discountTotal,
      netAmount,
      createdAtDate: createdAt,
      proposedAtDate: proposedAt,
      acceptedAtDate: acceptedAt,
      items,
      row: planRow,
    });
  }
}
