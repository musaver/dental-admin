import {
  uuid,
  int,
  pick,
  pickN,
  chance,
  weighted,
  shuffle,
  dt,
  day,
  at,
  plusDays,
  plusMinutes,
  nextClinicDay,
  TODAY,
  MALE_FIRST,
  FEMALE_FIRST,
  LAST_NAMES,
  mobile,
} from './context.mjs';

/**
 * Leads and the funnel, internal tasks, the communication record, in-app
 * notifications and the audit trail.
 *
 * Two invariants the schema cannot express are honoured here by construction:
 * leads.convertedPatientId ↔ patients.leadId is written on both sides, and
 * every communication_logs row carries a patientId XOR a leadId.
 */

/* ── Vocabularies (copied literals — lib/ is TypeScript) ──────────────── */

const LEAD_SOURCE_WEIGHTS = [
  ['instagram', 30],
  ['facebook', 24],
  ['walk_in', 14],
  ['referral', 11],
  ['google', 9],
  ['website', 7],
  ['phone', 5],
  ['other', 2],
];

const SOURCE_LABEL = {
  walk_in: 'walk-in',
  phone: 'phone call',
  referral: 'referral',
  facebook: 'Facebook message',
  instagram: 'Instagram DM',
  google: 'Google search',
  website: 'website form',
  other: 'enquiry',
};

const LOST_REASONS = [
  'Price too high',
  'Went to a closer clinic',
  'Stopped responding',
  'Only wanted a quote',
];

/** What the enquirer actually asked for, and the procedure it maps to. */
const INTERESTS = [
  ['Asking about braces price for daughter', 'ORT-02'],
  ['Wants whitening before wedding in Nov', 'COS-01'],
  ['Tooth pain, asking if open on Sunday', null],
  ['Implant cost for lower molar', 'IMP-01'],
  ['Wants invisible braces, asked for a consultation first', 'ORT-02'],
  ['Bleeding gums for a month, wants a cleaning', 'SC-01'],
  ['Front tooth chipped last week, asked for a filling quote', 'RES-01'],
  ['Another clinic quoted 30k for a root canal', 'END-03'],
  ['Lower right wisdom tooth swollen, wants it out', 'SUR-03'],
  ['Broken molar — asking crown vs extraction', 'PRO-02'],
  ['Six-year-old has black spots on the back teeth', 'PED-01'],
  ['Wants a full checkup and scaling before travelling', 'SC-01'],
  ['Just wants a consultation to know the options', 'CON-01'],
  ['Asked if the OPG can be done the same day', 'XR-02'],
  ['Loose tooth on her mother, asking about extraction', 'SUR-01'],
  ['Old filling fell out, asking the cost to redo it', 'RES-02'],
];

const CAMPAIGNS = {
  instagram: [
    { utm_source: 'instagram', utm_campaign: 'braces-aug', form: 'dm' },
    { utm_source: 'instagram', utm_campaign: 'whitening-eid', form: 'story_reply' },
    { utm_source: 'instagram', utm_campaign: 'implants-jul', form: 'lead_form' },
  ],
  facebook: [
    { utm_source: 'facebook', utm_campaign: 'checkup-1000', form: 'messenger' },
    { utm_source: 'facebook', utm_campaign: 'braces-aug', form: 'lead_form' },
    { utm_source: 'facebook', utm_campaign: 'smile-makeover', form: 'comment' },
  ],
  google: [
    { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'dentist-near-me', keyword: 'braces price' },
    { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'implant-lahore', keyword: 'dental implant cost' },
  ],
  website: [
    { utm_source: 'website', utm_medium: 'organic', form: 'contact_page' },
    { utm_source: 'website', utm_medium: 'organic', form: 'price_list_download' },
  ],
};

const ACTIVITY_NOTES = {
  'call:no_answer': [
    'Called twice, no answer.',
    'No answer. Will try again after 6pm.',
    'Rang out. Number is on WhatsApp so tried there too.',
  ],
  'call:connected': [
    'Spoke to her, taking the details to her husband first.',
    'Answered. Asked us to call back after Friday prayers.',
    'Explained the timings and where we are. Sounded keen.',
  ],
  'call:interested': [
    'Went through the package and the instalment option. Wants a Saturday slot.',
    'Happy with the quote. Asked for the earliest morning appointment.',
    'Asked about the dentist and how long it takes. Will confirm tomorrow.',
  ],
  'call:not_interested': [
    'Said the price is above her budget. Not proceeding.',
    'Has already started treatment somewhere closer to home.',
    'Only wanted a figure for comparison. Not booking.',
  ],
  'call:callback': [
    'Asked us to call back next week, travelling till Sunday.',
    'Busy at work. Callback agreed for Monday morning.',
  ],
  'whatsapp:connected': [
    'Sent the price list on WhatsApp. She replied asking about instalments.',
    'Shared the location pin and the clinic timings.',
    'Sent before/after photos of a similar case.',
  ],
  'whatsapp:interested': [
    'Asked for the total including the X-ray. Sent a written estimate.',
    'Wants to bring her daughter along on the same visit.',
  ],
  'whatsapp:no_answer': [
    'Message delivered, no reply yet.',
    'Two blue ticks, no response.',
  ],
  'sms:no_answer': [
    'Sent an SMS with the clinic timings. No reply.',
    'SMS sent with the consultation fee. Nothing back.',
  ],
  'visit:connected': [
    'Came in for the consultation and registered as a patient.',
    'Walked in with the X-ray from the other clinic. Registered.',
  ],
  'visit:interested': [
    'Came to see the clinic and took the written quote home.',
  ],
};

const NEW_ENQUIRY_NOTES = [
  'Enquiry came in through the {source}. Details taken.',
  'New {source} — noted what she is asking about, not called yet.',
  'Logged from the {source}. Number confirmed with her.',
];

/** Titles that stand alone — the office to-do list, not the lead queue. */
const GENERAL_TASKS = [
  ['Order composite shades A2/A3 — running low', 'Two syringes left of A2. Same supplier as last time.'],
  ['Autoclave service due — call vendor', 'Annual service, last done in February. Certificate goes in the folder at reception.'],
  ['Follow up insurance claim for Jubilee — 2 invoices pending', 'Submitted three weeks ago, nothing received.'],
  ['Fix Chair 2 suction — weak', 'Assistant reports it barely pulls during scaling. Check the trap first.'],
  ['Reorder articaine, down to one box', null],
  ['Get the compressor serviced before the monsoon', 'It tripped twice last year when the humidity rose.'],
  ['Renew the PMDC display certificate at reception', null],
  ['Print new consent forms — English and Urdu', 'The extraction one still has the old clinic phone number on it.'],
  ['Chase the courier for the implant kit', 'Dispatched Monday, still not here.'],
  ['Book the fire extinguisher refill', null],
  ['Update the price list on the website — ortho changed', 'Fixed braces moved to 150,000. The site still shows the old figure.'],
  ['Reconcile last month cash drawer with the payments report', null],
  ['Arrange the sharps disposal pickup', 'Two bins full in the back room.'],
  ['Replace the X-ray lead apron — strap torn', null],
  ['Ask the lab for a credit note on the remade crown', 'Second remake on the same unit. They agreed on the phone.'],
  ['Schedule the staff CPR refresher', null],
  ['Deep clean the sterilisation room', 'Sunday, clinic is closed. Coordinate with the cleaner.'],
  ['Chase the internet provider about the reception line', 'Dropping every afternoon, the card machine goes offline with it.'],
  ['Draft the Eid holiday roster', 'One dentist and one receptionist on each of the three days.'],
  ['Buy bibs and suction tips for both branches', null],
  ['Check the emergency drug kit expiry dates', 'Adrenaline and the glucose gel expire soonest.'],
];

const TASK_COMMENTS = [
  'Lab says Thursday.',
  'Ordered, arriving Monday.',
  'Called, they will send someone this week.',
  'Left a message, waiting on a callback.',
  'Done — receipt is in the drawer.',
  'Vendor wants payment first. Passed to accounts.',
  'Pushed to next week, parts not in stock.',
  'Checked it myself, still the same problem.',
  'Patient confirmed on WhatsApp.',
  'Sent. Copy filed in the patient record.',
  'Quote received, 12,500. Need approval.',
  'Chased again today.',
];

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
];

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ── Small helpers ────────────────────────────────────────────────────── */

/**
 * Earlier modules may register a datetime as a Date or as the naive string the
 * driver wants. `new Date(string)` would read the string in the machine's own
 * zone, so parse the digits explicitly instead.
 */
function asDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string') {
    const full = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (full) {
      return new Date(Date.UTC(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +full[6]));
    }
    const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      return new Date(Date.UTC(+dateOnlyMatch[1], +dateOnlyMatch[2] - 1, +dateOnlyMatch[3]));
    }
  }
  return new Date(TODAY.getTime());
}

function earliest(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function latest(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** A working-hours moment on the day `n` days from the anchor. */
function moment(offsetDays, minHour = 9, maxHour = 19) {
  return at(day(offsetDays), int(minHour, maxHour), int(0, 59));
}

/** Recent-weighted day offset in [-maxAgo, 0]: the minimum of two uniforms. */
function recentOffset(maxAgo) {
  return -Math.min(int(0, maxAgo), int(0, maxAgo));
}

/** Nothing already recorded may be stamped later than the anchor "now". */
function notFuture(date) {
  return date.getTime() <= TODAY.getTime() ? date : at(day(0), int(8, 11), int(0, 59));
}

/** Clamp any moment into the window the demo data covers. */
function inWindow(date, maxAgoDays) {
  const floor = day(-maxAgoDays);
  if (date.getTime() < floor.getTime()) return at(floor, int(9, 18), int(0, 59));
  return notFuture(date);
}

/** n ascending contact times between two moments, always inside clinic hours. */
function trailTimes(start, end, n) {
  const span = Math.max(n, daysBetween(start, end));
  const gap = Math.max(1, Math.floor(span / (n + 1)));
  const out = [];
  let cursor = new Date(start.getTime());
  for (let i = 0; i < n; i += 1) {
    let t = at(plusDays(cursor, i === 0 ? int(0, 1) : int(1, gap + 2)), int(9, 19), int(0, 59));
    if (t.getTime() > end.getTime()) t = at(end, int(9, 18), int(0, 55));
    if (t.getTime() <= cursor.getTime()) t = plusMinutes(cursor, int(25, 180));
    cursor = t;
    out.push(t);
  }
  return out;
}

function formatDateTime(date) {
  const h24 = date.getUTCHours();
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? 'am' : 'pm';
  const mins = String(date.getUTCMinutes()).padStart(2, '0');
  return (
    `${DAY_ABBR[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()}, ${h12}:${mins} ${ampm}`
  );
}

/** Shaped like the Message-ID Brevo returns, so webhook code has something real. */
function brevoId(date) {
  const stamp = dt(date).replace(/[-: ]/g, '').slice(0, 12);
  return `<${stamp}.${int(10000000000, 99999999999)}@smtp-relay.mailin.fr>`;
}

function ipAddress() {
  return chance(0.55)
    ? `203.135.${int(1, 254)}.${int(1, 254)}`
    : `39.${int(32, 63)}.${int(1, 254)}.${int(1, 254)}`;
}

function contactTrail(status) {
  if (status === 'converted') {
    const trail = [
      ['call', 'no_answer'],
      ['whatsapp', 'connected'],
      ['call', 'interested'],
      ['visit', 'connected'],
    ];
    if (chance(0.3)) trail.push(['note', null]);
    return trail;
  }
  if (status === 'lost') {
    if (chance(0.5)) {
      const trail = [['call', 'connected'], ['whatsapp', 'connected']];
      if (chance(0.4)) trail.push(['call', 'callback']);
      trail.push(['call', 'not_interested']);
      return trail;
    }
    const trail = [['call', 'no_answer'], ['sms', 'no_answer']];
    if (chance(0.6)) trail.push(['call', 'no_answer']);
    return trail;
  }
  if (status === 'qualified') {
    const trail = [['call', 'connected'], ['whatsapp', 'interested']];
    if (chance(0.4)) trail.push(['call', 'interested']);
    return trail;
  }
  if (status === 'follow_up') {
    const trail = [['call', 'no_answer'], ['whatsapp', 'connected']];
    if (chance(0.4)) trail.push(['call', 'callback']);
    return trail;
  }
  if (status === 'contacted') {
    return chance(0.5)
      ? [['call', 'connected'], ['whatsapp', 'connected']]
      : [['call', 'no_answer'], ['call', 'connected']];
  }
  return [['note', null]];
}

function activityNote(type, outcome, source) {
  if (type === 'note' && !outcome) {
    return pick(NEW_ENQUIRY_NOTES).replace('{source}', SOURCE_LABEL[source] ?? 'enquiry');
  }
  const bank = ACTIVITY_NOTES[`${type}:${outcome ?? 'none'}`];
  return bank ? pick(bank) : `Logged a ${type}.`;
}

/* ── Module ───────────────────────────────────────────────────────────── */

export default function build(world, rows) {
  const branches = world.branches ?? [];
  const staff = world.staff ?? [];
  const patients = world.patients ?? [];
  const procedures = world.procedures ?? [];
  const appointments = world.appointments ?? [];
  const visits = world.visits ?? [];
  const recalls = world.recalls ?? [];
  const invoices = world.invoices ?? [];
  const plans = world.plans ?? [];
  // Billing and clinical push these rows but never register them on `world`,
  // so read what the earlier modules actually built. Trusting `world` alone
  // left the payment audit loop emitting nothing at all, and stamped every
  // prescription/file view with a null entityId via the patient fallback.
  const built = (table) => rows.all().get(table) ?? [];
  const fromWorld = (value, table) =>
    Array.isArray(value) && value.length ? value : built(table);

  const payments = fromWorld(world.payments, 'payments');
  const prescriptions = fromWorld(world.prescriptions, 'prescriptions');
  const patientFiles = fromWorld(world.patientFiles, 'patient_files');

  const staffById = new Map(staff.map((s) => [s.id, s]));
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const procedureByCode = new Map(procedures.map((p) => [p.code, p]));

  const deskPool = staff.filter((s) => s.staffType === 'receptionist' || s.staffType === 'manager');
  const desk = deskPool.length ? deskPool : staff;
  const clinicians = staff.filter((s) => s.isClinical);
  const anyStaff = staff.length ? staff : desk;

  /** Front-desk staff at a branch; the owner has no branch and covers both. */
  function deskFor(branchId) {
    const local = desk.filter((s) => !s.branchId || s.branchId === branchId);
    return pick(local.length ? local : desk);
  }

  function staffName(id) {
    return staffById.get(id)?.name ?? 'Reception';
  }

  function dentistName(id) {
    const s = staffById.get(id);
    return s ? `Dr. ${s.name.replace(/^Dr\.?\s*/i, '')}` : 'the dentist';
  }

  /* ── Leads ──────────────────────────────────────────────────────────── */

  // Patients nobody has claimed yet; a lead converts into exactly one of them.
  const convertible = shuffle(patients.filter((p) => p.row && !p.row.leadId));

  const LEAD_PLAN = [
    ['new', 7, 1, 12],
    ['contacted', 9, 3, 30],
    ['follow_up', 8, 6, 70],
    ['qualified', 6, 10, 95],
    ['converted', 10, 25, 150],
    ['lost', 6, 12, 140],
  ];

  const leadEntries = [];
  let convertedTaken = 0;
  let phoneSeed = 700;

  for (const [plannedStatus, count, minAgo, maxAgo] of LEAD_PLAN) {
    for (let i = 0; i < count; i += 1) {
      let status = plannedStatus;
      let patient = null;
      if (status === 'converted') {
        patient = convertible[convertedTaken] ?? null;
        if (patient) convertedTaken += 1;
        // No unclaimed patient left: keep the lead in the funnel rather than
        // writing half a pointer pair.
        else status = 'qualified';
      }

      const createdAt = moment(-int(minAgo, maxAgo));
      const branchId = patient
        ? patient.branchId
        : (branches.length ? pick(branches).id : null);

      let name;
      let phone;
      let email;
      if (patient) {
        name = patient.fullName ?? `${patient.firstName} ${patient.lastName}`.trim();
        phone = patient.phone;
        email = patient.email ?? null;
      } else {
        phoneSeed += 1;
        const female = chance(0.55);
        const first = pick(female ? FEMALE_FIRST : MALE_FIRST);
        const last = pick(LAST_NAMES);
        name = `${first} ${last}`;
        phone = mobile(phoneSeed);
        email = chance(0.55)
          ? `${first.toLowerCase()}.${last.toLowerCase()}${int(1, 99)}@gmail.com`
          : null;
      }

      const [interestNote, procedureCode] = pick(INTERESTS);
      const source = weighted(LEAD_SOURCE_WEIGHTS);
      const campaigns = CAMPAIGNS[source];
      const assignedTo = deskFor(branchId).id;
      const createdBy = chance(0.75) ? assignedTo : deskFor(branchId).id;

      let convertedAt = null;
      if (patient) {
        convertedAt = notFuture(at(plusDays(createdAt, int(3, 21)), int(10, 18), int(0, 59)));
        if (convertedAt.getTime() <= createdAt.getTime()) {
          convertedAt = plusMinutes(createdAt, int(120, 600));
        }
      }

      const id = uuid();
      const row = rows.push('leads', {
        id,
        branchId,
        name,
        phone,
        email,
        source,
        interestedProcedureId: procedureCode ? (procedureByCode.get(procedureCode)?.id ?? null) : null,
        interestNote,
        status,
        lostReason: status === 'lost' ? pick(LOST_REASONS) : null,
        assignedTo,
        nextFollowUpAt: null,
        convertedPatientId: patient ? patient.id : null,
        convertedAt: convertedAt ? dt(convertedAt) : null,
        createdBy,
        createdAt: dt(createdAt),
        updatedAt: dt(createdAt),
        metadata: campaigns ? pick(campaigns) : null,
      });

      // The other half of the pointer pair. A one-sided link fails the build.
      if (patient) patient.row.leadId = id;

      leadEntries.push({
        id,
        branchId,
        name,
        status,
        source,
        assignedTo,
        createdAt,
        convertedAt,
        convertedPatientId: patient ? patient.id : null,
        patient,
        row,
      });
    }
  }

  /* ── Lead activities ────────────────────────────────────────────────── */

  for (const lead of leadEntries) {
    const trail = contactTrail(lead.status);
    let end;
    if (lead.status === 'converted' && lead.convertedAt) {
      end = lead.convertedAt;
    } else if (lead.status === 'lost') {
      end = earliest(plusDays(lead.createdAt, int(10, 40)), moment(-1, 10, 17));
    } else {
      end = earliest(plusDays(lead.createdAt, int(5, 45)), moment(recentOffset(3), 10, 17));
    }
    end = notFuture(latest(end, plusMinutes(lead.createdAt, 90)));

    const times = trailTimes(lead.createdAt, end, trail.length);
    let last = lead.createdAt;

    trail.forEach(([activityType, outcome], index) => {
      const createdAt = times[index];
      const isConversionNote =
        activityType === 'note' && lead.status === 'converted' && index === trail.length - 1;
      rows.push('lead_activities', {
        id: uuid(),
        leadId: lead.id,
        activityType,
        note: isConversionNote
          ? `Converted to patient ${lead.patient?.mrn ?? ''}`.trim()
          : activityNote(activityType, outcome, lead.source),
        outcome: isConversionNote ? null : outcome,
        performedBy: lead.assignedTo,
        createdAt: dt(createdAt),
      });
      last = createdAt;
    });

    lead.lastActivityAt = last;
    lead.row.updatedAt = dt(lead.status === 'converted' && lead.convertedAt ? latest(last, lead.convertedAt) : last);
  }

  /* ── The follow-up worklist ─────────────────────────────────────────── */

  const openLeads = shuffle(
    leadEntries.filter((l) => ['new', 'contacted', 'follow_up', 'qualified'].includes(l.status))
  );

  openLeads.forEach((lead, index) => {
    let target;
    if (index < 8) {
      // Deliberately overdue, so the worklist opens with real work on it.
      target = nextClinicDay(day(-int(1, 14)));
      if (target.getTime() <= lead.createdAt.getTime()) {
        target = nextClinicDay(plusDays(lead.createdAt, 1));
      }
    } else {
      target = nextClinicDay(day(int(1, 21)));
    }
    lead.row.nextFollowUpAt = dt(at(target, int(10, 17), pick([0, 15, 30, 45])));
  });

  world.leads = leadEntries.map((l) => ({
    id: l.id,
    branchId: l.branchId,
    name: l.name,
    status: l.status,
    convertedPatientId: l.convertedPatientId,
    row: l.row,
  }));

  /* ── Tasks ──────────────────────────────────────────────────────────── */

  const taskSpecs = [];
  const patientsForTasks = pickN(patients, Math.min(8, patients.length));
  const PATIENT_TASK_TITLES = [
    ['Chase Al-Shifa lab about zirconia crown for MRN {mrn}', 'Sent on the 12th, promised in five working days.'],
    ['Get medical clearance from the cardiologist for MRN {mrn}', 'On warfarin. No extraction until the letter is in the file.'],
    ['Post-op call for MRN {mrn} after the wisdom extraction', null],
    ['Reschedule MRN {mrn} — she asked for an evening slot', null],
    ['Send the OPG for MRN {mrn} to Dr. Salman for an ortho opinion', 'Second opinion before we quote the fixed appliance.'],
    ['Bank transfer for MRN {mrn} not showing — check with the bank', 'Patient has the receipt, our statement does not.'],
    ['Chase the signed consent form for MRN {mrn}', null],
    ['Confirm the denture try-in date for MRN {mrn} with the lab', null],
  ];
  patientsForTasks.forEach((patient, i) => {
    const [title, description] = PATIENT_TASK_TITLES[i % PATIENT_TASK_TITLES.length];
    taskSpecs.push({
      title: title.replace('{mrn}', patient.mrn),
      description,
      patientId: patient.id,
      leadId: null,
      branchId: patient.branchId,
    });
  });

  const leadsForTasks = pickN(
    leadEntries.filter((l) => ['new', 'contacted', 'follow_up', 'qualified'].includes(l.status)),
    3
  );
  const LEAD_TASK_TITLES = [
    ['Send the braces price list to {name}', 'She asked for it in writing, including the instalment plan.'],
    ['Book the consultation {name} asked for on WhatsApp', null],
    ['Second follow-up call to {name} about the implant quote', 'First call went to voicemail.'],
  ];
  leadsForTasks.forEach((lead, i) => {
    const [title, description] = LEAD_TASK_TITLES[i % LEAD_TASK_TITLES.length];
    taskSpecs.push({
      title: title.replace('{name}', lead.name).slice(0, 255),
      description,
      patientId: null,
      leadId: lead.id,
      branchId: lead.branchId,
    });
  });

  for (const [title, description] of GENERAL_TASKS) {
    taskSpecs.push({
      title,
      description,
      patientId: null,
      leadId: null,
      branchId: branches.length ? pick(branches).id : null,
    });
  }

  // 18 open, 5 in_progress, 8 done, 1 cancelled — the first five open ones are
  // deliberately overdue.
  const statusSlots = [
    ...Array(18).fill('open'),
    ...Array(5).fill('in_progress'),
    ...Array(8).fill('done'),
    'cancelled',
  ];
  const prioritySlots = shuffle([
    ...Array(2).fill('urgent'),
    ...Array(6).fill('high'),
    ...Array(4).fill('low'),
    ...Array(Math.max(0, taskSpecs.length - 12)).fill('normal'),
  ]);

  const orderedSpecs = shuffle(taskSpecs);
  const taskEntries = [];
  let overdueMade = 0;

  orderedSpecs.forEach((spec, index) => {
    const status = statusSlots[index] ?? 'open';
    const assignee = spec.patientId && chance(0.4) ? pick(clinicians.length ? clinicians : anyStaff) : pick(anyStaff);
    let dueOffset;
    if (status === 'open' && overdueMade < 5) {
      dueOffset = -int(1, 12);
      overdueMade += 1;
    } else if (status === 'open') {
      dueOffset = int(1, 30);
    } else if (status === 'in_progress') {
      dueOffset = int(-3, 7);
    } else {
      dueOffset = -int(2, 60);
    }

    // A task is raised before it falls due, and never after the anchor "now".
    // Without these the driver would fall back to the column's CURRENT_TIMESTAMP
    // default, which is neither deterministic nor consistent with the dueDate.
    const dueAt = at(nextClinicDay(day(dueOffset)), pick([12, 17, 18]), 0);
    const createdAt = inWindow(at(plusDays(dueAt, -int(2, 21)), int(9, 18), int(0, 59)), 120);
    const touchedAt =
      status === 'open' ? createdAt : notFuture(plusMinutes(createdAt, int(120, 14400)));

    const id = uuid();
    const row = rows.push('tasks', {
      id,
      title: spec.title,
      description: spec.description,
      patientId: spec.patientId,
      leadId: spec.leadId,
      branchId: spec.branchId,
      assignedTo: assignee.id,
      dueDate: dt(dueAt),
      status,
      priority: prioritySlots[index] ?? 'normal',
      createdBy: pick(anyStaff).id,
      createdAt: dt(createdAt),
      updatedAt: dt(touchedAt),
    });

    taskEntries.push({
      id,
      title: spec.title,
      branchId: spec.branchId,
      assignedTo: assignee.id,
      status,
      dueOffset,
      row,
    });
  });

  world.tasks = taskEntries.map((t) => ({
    id: t.id,
    title: t.title,
    branchId: t.branchId,
    assignedTo: t.assignedTo,
    row: t.row,
  }));

  /* ── Task comments ──────────────────────────────────────────────────── */

  for (const task of pickN(taskEntries, Math.min(10, taskEntries.length))) {
    let cursor = moment(-int(12, 40), 9, 12);
    const commentCount = int(2, 3);
    for (let i = 0; i < commentCount; i += 1) {
      const author = pick(anyStaff);
      cursor = notFuture(plusMinutes(cursor, int(240, 3600)));
      rows.push('task_comments', {
        id: uuid(),
        taskId: task.id,
        authorId: author.id,
        authorType: 'admin',
        authorName: author.name,
        comment: pick(TASK_COMMENTS),
        createdAt: dt(cursor),
      });
    }
  }

  /* ── Communication logs ─────────────────────────────────────────────── */

  const emailPatients = patients.filter((p) => p.email);
  const emailPatientIds = new Set(emailPatients.map((p) => p.id));
  const phoneOnlyIds = new Set(patients.filter((p) => !p.email).map((p) => p.id));

  function logComm(fields) {
    rows.push('communication_logs', {
      id: uuid(),
      patientId: fields.patientId ?? null,
      leadId: fields.leadId ?? null,
      channel: fields.channel,
      direction: fields.direction ?? 'outbound',
      subject: fields.subject ?? null,
      body: fields.body ?? null,
      status: fields.status ?? 'logged',
      referenceType: fields.referenceType ?? null,
      referenceId: fields.referenceId ?? null,
      performedBy: fields.performedBy ?? null,
      createdAt: dt(notFuture(fields.createdAt)),
      templateKey: fields.templateKey ?? null,
      providerMessageId: fields.providerMessageId ?? null,
    });
  }

  const emailAppointments = appointments.filter((a) => emailPatientIds.has(a.patientId));
  const phoneOnlyAppointments = appointments.filter((a) => phoneOnlyIds.has(a.patientId));

  // Booking confirmations.
  for (const appt of pickN(emailAppointments, Math.min(40, emailAppointments.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    const bookedAt = inWindow(at(plusDays(start, -int(2, 20)), int(9, 18), int(0, 59)), 150);
    const when = formatDateTime(start);
    logComm({
      patientId: patient.id,
      channel: 'email',
      direction: 'outbound',
      subject: `Your appointment on ${when}`,
      body: `Dear ${patient.fullName}, your appointment is booked for ${when} with ${dentistName(appt.dentistId)}.`,
      status: chance(0.45) ? 'delivered' : 'sent',
      referenceType: 'appointment',
      referenceId: appt.id,
      performedBy: deskFor(appt.branchId).id,
      createdAt: bookedAt,
      templateKey: 'appointment_confirmation',
      providerMessageId: brevoId(bookedAt),
    });
  }

  // 24h reminders — only for appointments whose reminder has already fallen due.
  const remindable = emailAppointments.filter(
    (a) => asDate(a.startAt).getTime() <= plusDays(TODAY, 1).getTime()
  );
  for (const appt of pickN(remindable, Math.min(34, remindable.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    const sentAt = inWindow(at(plusDays(start, -1), 18, int(0, 30)), 150);
    const when = formatDateTime(start);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: `Reminder: your appointment on ${when}`,
      body: `Dear ${patient.fullName}, a reminder that you have an appointment on ${when} with ${dentistName(appt.dentistId)}.`,
      status: chance(0.5) ? 'delivered' : 'sent',
      referenceType: 'appointment',
      referenceId: appt.id,
      performedBy: null,
      createdAt: sentAt,
      templateKey: 'appointment_reminder',
      providerMessageId: brevoId(sentAt),
    });
  }

  // Cancellation confirmations.
  const cancelled = emailAppointments.filter((a) => a.status === 'cancelled');
  for (const appt of pickN(cancelled, Math.min(6, cancelled.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    const sentAt = inWindow(at(plusDays(start, -int(1, 4)), int(10, 17), int(0, 59)), 150);
    const when = formatDateTime(start);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: `Your appointment on ${when} has been cancelled`,
      body: `Dear ${patient.fullName}, your appointment on ${when} has been cancelled. Call us whenever you would like to rebook.`,
      status: 'sent',
      referenceType: 'appointment',
      referenceId: appt.id,
      performedBy: deskFor(appt.branchId).id,
      createdAt: sentAt,
      templateKey: 'appointment_cancelled',
      providerMessageId: brevoId(sentAt),
    });
  }

  // Recall invitations.
  const emailRecalls = recalls.filter(
    (r) => emailPatientIds.has(r.patientId) && r.status !== 'pending'
  );
  const recallPool = emailRecalls.length
    ? emailRecalls
    : recalls.filter((r) => emailPatientIds.has(r.patientId));
  for (const recall of pickN(recallPool, Math.min(16, recallPool.length))) {
    const patient = patientById.get(recall.patientId);
    const due = asDate(recall.dueDate);
    const sentAt = inWindow(at(plusDays(due, -int(0, 5)), int(9, 12), int(0, 59)), 150);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: 'Time for your next dental visit',
      body: `Dear ${patient.fullName}, it has been a while since your last ${recall.recallType} visit and you are due for a check-up.`,
      status: chance(0.4) ? 'delivered' : 'sent',
      referenceType: 'recall',
      referenceId: recall.id,
      performedBy: null,
      createdAt: sentAt,
      templateKey: 'recall_due',
      providerMessageId: brevoId(sentAt),
    });
  }

  // Payment reminders on invoices that still carry a balance.
  const owing = invoices.filter(
    (inv) => emailPatientIds.has(inv.patientId) && (inv.totalAmount ?? 0) > (inv.paidAmount ?? 0)
  );
  const owingPool = owing.length ? owing : invoices.filter((inv) => emailPatientIds.has(inv.patientId));
  for (const invoice of pickN(owingPool, Math.min(10, owingPool.length))) {
    const patient = patientById.get(invoice.patientId);
    const balance = Math.max(0, (invoice.totalAmount ?? 0) - (invoice.paidAmount ?? 0));
    const sentAt = moment(recentOffset(70), 10, 16);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: `Outstanding balance on invoice ${invoice.invoiceNumber}`,
      body: `Dear ${patient.fullName}, invoice ${invoice.invoiceNumber} has an outstanding balance of Rs ${balance}.`,
      status: chance(0.5) ? 'delivered' : 'sent',
      referenceType: 'invoice',
      referenceId: invoice.id,
      performedBy: deskFor(invoice.branchId).id,
      createdAt: sentAt,
      templateKey: 'payment_reminder',
      providerMessageId: brevoId(sentAt),
    });
  }

  // Plans put to the patient.
  const proposedPlans = plans.filter(
    (p) => emailPatientIds.has(p.patientId) && p.status !== 'draft'
  );
  for (const plan of pickN(proposedPlans, Math.min(8, proposedPlans.length))) {
    const patient = patientById.get(plan.patientId);
    const sentAt = moment(recentOffset(100), 11, 18);
    const title = plan.title ?? 'Treatment plan';
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: `Your treatment plan: ${title}`.slice(0, 255),
      body: `Dear ${patient.fullName}, ${dentistName(plan.dentistId)} has prepared a treatment plan for you: ${title}.`,
      status: chance(0.5) ? 'delivered' : 'sent',
      referenceType: 'treatment_plan',
      referenceId: plan.id,
      performedBy: plan.dentistId ?? null,
      createdAt: sentAt,
      templateKey: 'treatment_plan_proposed',
      providerMessageId: brevoId(sentAt),
    });
  }

  // Portal invitations.
  const portalPatients = emailPatients.filter((p) => p.portalUserId);
  const portalPool = portalPatients.length ? portalPatients : emailPatients;
  for (const patient of pickN(portalPool, Math.min(8, portalPool.length))) {
    const sentAt = moment(recentOffset(90), 10, 17);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: 'Your patient portal',
      body: `Dear ${patient.fullName}, you can now see your appointments, treatment plans and invoices online. The activation link expires in 7 days.`,
      status: chance(0.7) ? 'delivered' : 'sent',
      referenceType: 'portal',
      referenceId: patient.id,
      performedBy: deskFor(patient.branchId).id,
      createdAt: sentAt,
      templateKey: 'portal_invite',
      providerMessageId: brevoId(sentAt),
    });
  }

  // A missing address is a skipped row, not an error — this is the call list.
  let skipped = 0;
  for (const appt of pickN(phoneOnlyAppointments, Math.min(7, phoneOnlyAppointments.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: `Reminder: your appointment on ${formatDateTime(start)}`,
      body: null,
      status: 'skipped',
      referenceType: 'appointment',
      referenceId: appt.id,
      performedBy: null,
      createdAt: inWindow(at(plusDays(start, -1), 18, int(0, 30)), 150),
      templateKey: 'appointment_reminder',
      providerMessageId: null,
    });
    skipped += 1;
  }
  const phoneOnlyRecalls = recalls.filter((r) => phoneOnlyIds.has(r.patientId));
  for (const recall of pickN(phoneOnlyRecalls, Math.min(12 - skipped, phoneOnlyRecalls.length))) {
    logComm({
      patientId: recall.patientId,
      channel: 'email',
      subject: 'Time for your next dental visit',
      body: null,
      status: 'skipped',
      referenceType: 'recall',
      referenceId: recall.id,
      performedBy: null,
      createdAt: inWindow(at(asDate(recall.dueDate), int(9, 11), int(0, 59)), 150),
      templateKey: 'recall_due',
      providerMessageId: null,
    });
    skipped += 1;
  }
  const phoneOnlyPatients = patients.filter((p) => !p.email);
  for (const patient of pickN(phoneOnlyPatients, Math.max(0, Math.min(12 - skipped, phoneOnlyPatients.length)))) {
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: 'Your patient portal',
      body: null,
      status: 'skipped',
      referenceType: 'portal',
      referenceId: patient.id,
      performedBy: deskFor(patient.branchId).id,
      createdAt: moment(recentOffset(60), 10, 16),
      templateKey: 'portal_invite',
      providerMessageId: null,
    });
    skipped += 1;
  }

  // Hard bounces and provider failures.
  for (const patient of pickN(emailPatients, Math.min(3, emailPatients.length))) {
    const sentAt = moment(recentOffset(80), 10, 16);
    const recall = recalls.find((r) => r.patientId === patient.id) ?? null;
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: 'Time for your next dental visit',
      body: `Dear ${patient.fullName}, you are due for a check-up.`,
      status: 'bounced',
      referenceType: recall ? 'recall' : null,
      referenceId: recall ? recall.id : null,
      performedBy: null,
      createdAt: sentAt,
      templateKey: 'recall_due',
      providerMessageId: brevoId(sentAt),
    });
  }
  for (const patient of pickN(emailPatients, Math.min(2, emailPatients.length))) {
    const sentAt = moment(recentOffset(50), 10, 16);
    logComm({
      patientId: patient.id,
      channel: 'email',
      subject: 'Your patient portal',
      body: `Dear ${patient.fullName}, activate your portal account.`,
      status: 'failed',
      referenceType: 'portal',
      referenceId: patient.id,
      performedBy: deskFor(patient.branchId).id,
      createdAt: sentAt,
      templateKey: 'portal_invite',
      providerMessageId: null,
    });
  }

  // Everything staff record by hand. Nothing dispatches these.
  const MANUAL_OUTBOUND = [
    ['whatsapp', 'Sent the treatment estimate on WhatsApp.', 'Estimate sent'],
    ['whatsapp', 'Sent the post-op instructions and the painkiller dose.', 'Post-op instructions'],
    ['call', 'Called to confirm tomorrow morning. Confirmed.', 'Confirmation call'],
    ['call', 'Called about the outstanding balance. Will pay at the next visit.', 'Balance call'],
    ['sms', 'SMS with the clinic address and parking directions.', 'Directions'],
    ['in_person', 'Went through the plan at the desk and gave a printed copy.', 'Plan discussed at reception'],
    ['whatsapp', 'Sent the receipt photo she asked for.', 'Receipt sent'],
    ['call', 'Called after the no-show. No answer, left a voicemail.', 'No-show follow-up'],
  ];
  const MANUAL_INBOUND = [
    ['call', 'Patient called asking to move Tuesday appointment.', 'Reschedule request'],
    ['call', 'Called about pain after the extraction. Advised to come in.', 'Post-op pain'],
    ['whatsapp', 'Messaged asking for a copy of the invoice.', 'Invoice copy requested'],
    ['whatsapp', 'Sent a photo of the swelling and asked if it is normal.', 'Photo sent by patient'],
    ['call', 'Asked whether we are open on Sunday.', 'Timings enquiry'],
  ];

  const commPatients = pickN(patients, Math.min(20, patients.length));
  for (const patient of commPatients) {
    const inbound = chance(0.35);
    const [channel, body, subject] = inbound ? pick(MANUAL_INBOUND) : pick(MANUAL_OUTBOUND);
    logComm({
      patientId: patient.id,
      channel,
      direction: inbound ? 'inbound' : 'outbound',
      subject,
      body,
      status: 'logged',
      referenceType: null,
      referenceId: null,
      performedBy: deskFor(patient.branchId).id,
      createdAt: moment(recentOffset(90), 9, 19),
    });
  }

  // Lead-side messages. After conversion these stay reachable through
  // patients.leadId, which is why the XOR invariant is never rewritten.
  const LEAD_MESSAGES = [
    ['whatsapp', 'outbound', 'Price list sent', 'Sent the braces price list and the instalment options.'],
    ['whatsapp', 'inbound', 'Asked about instalments', 'She asked whether the 150,000 can be split over six months.'],
    ['call', 'outbound', 'Follow-up call', 'Called to check whether she had decided. Asked for another week.'],
    ['sms', 'outbound', 'Consultation fee', 'SMS with the consultation fee and the clinic timings.'],
    ['call', 'inbound', 'Enquiry call', 'Called asking if the dentist speaks Punjabi and what the checkup costs.'],
    ['in_person', 'inbound', 'Walked in for a quote', 'Came to the desk, took a written quote away with her.'],
  ];
  for (const lead of pickN(leadEntries, Math.min(14, leadEntries.length))) {
    const [channel, direction, subject, body] = pick(LEAD_MESSAGES);
    logComm({
      leadId: lead.id,
      channel,
      direction,
      subject,
      body,
      status: 'logged',
      referenceType: null,
      referenceId: null,
      performedBy: lead.assignedTo,
      createdAt: earliest(plusMinutes(lead.createdAt, int(60, 20000)), moment(recentOffset(2), 10, 17)),
    });
  }

  /* ── Notifications ──────────────────────────────────────────────────── */

  /** notifications.userId always references admin_users.id, never a stale pointer. */
  function notifyTarget(preferredId, pool) {
    if (preferredId && staffById.has(preferredId)) return preferredId;
    return pick(pool.length ? pool : anyStaff).id;
  }

  function notify(spec) {
    const createdAt = notFuture(spec.createdAt);
    const isRead = chance(0.6);
    const readAt = isRead ? plusMinutes(createdAt, int(3, 900)) : null;
    rows.push('notifications', {
      id: uuid(),
      userId: spec.userId,
      type: spec.type,
      title: spec.title.slice(0, 255),
      message: spec.message,
      link: spec.link,
      imageUrl: null,
      referenceId: spec.referenceId,
      isRead: isRead ? 1 : 0,
      readAt: readAt ? dt(earliest(readAt, TODAY)) : null,
      createdAt: dt(createdAt),
      userType: 'admin',
    });
  }

  for (const appt of pickN(appointments, Math.min(12, appointments.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    notify({
      userId: notifyTarget(appt.dentistId, clinicians),
      type: 'appointment_booked',
      title: 'New appointment booked',
      message: `${patient?.fullName ?? 'A patient'} — ${formatDateTime(start)}.`,
      link: `/schedule/${appt.id}`,
      referenceId: appt.id,
      createdAt: inWindow(at(plusDays(start, -int(1, 10)), int(9, 18), int(0, 59)), 60),
    });
  }

  const cancelledAppts = appointments.filter((a) => a.status === 'cancelled' || a.status === 'no_show');
  for (const appt of pickN(cancelledAppts, Math.min(6, cancelledAppts.length))) {
    const patient = patientById.get(appt.patientId);
    const start = asDate(appt.startAt);
    notify({
      userId: notifyTarget(appt.dentistId, clinicians),
      type: 'appointment_cancelled',
      title: 'Appointment cancelled',
      message: `${patient?.fullName ?? 'A patient'} cancelled ${formatDateTime(start)}.`,
      link: `/schedule/${appt.id}`,
      referenceId: appt.id,
      createdAt: inWindow(at(plusDays(start, -int(0, 3)), int(9, 18), int(0, 59)), 60),
    });
  }

  for (const task of pickN(taskEntries, Math.min(10, taskEntries.length))) {
    notify({
      userId: task.assignedTo,
      type: 'task_assigned',
      title: 'A task was assigned to you',
      message: task.title,
      link: '/tasks',
      referenceId: task.id,
      createdAt: moment(recentOffset(45), 9, 18),
    });
  }

  for (const lead of pickN(leadEntries, Math.min(8, leadEntries.length))) {
    notify({
      userId: lead.assignedTo,
      type: 'lead_assigned',
      title: 'New enquiry assigned to you',
      message: `${lead.name} — ${SOURCE_LABEL[lead.source] ?? lead.source}.`,
      link: '/leads',
      referenceId: lead.id,
      createdAt: plusMinutes(lead.createdAt, int(5, 120)),
    });
  }

  const paidInvoices = invoices.filter((inv) => (inv.paidAmount ?? 0) > 0);
  for (const invoice of pickN(paidInvoices, Math.min(8, paidInvoices.length))) {
    const patient = patientById.get(invoice.patientId);
    notify({
      userId: notifyTarget(null, desk),
      type: 'payment_received',
      title: 'Payment received',
      message: `Rs ${invoice.paidAmount} against ${invoice.invoiceNumber} for ${patient?.fullName ?? 'a patient'}.`,
      link: `/billing/${invoice.id}`,
      referenceId: invoice.id,
      createdAt: moment(recentOffset(60), 10, 18),
    });
  }

  const acceptedPlans = plans.filter((p) => p.status === 'accepted' || p.status === 'in_progress');
  for (const plan of pickN(acceptedPlans, Math.min(4, acceptedPlans.length))) {
    const patient = patientById.get(plan.patientId);
    notify({
      userId: notifyTarget(plan.dentistId, clinicians),
      type: 'treatment_plan_accepted',
      title: 'Treatment plan accepted',
      message: `${patient?.fullName ?? 'A patient'} accepted the plan.`,
      link: `/treatment-plans/${plan.id}`,
      referenceId: plan.id,
      createdAt: moment(recentOffset(70), 10, 18),
    });
  }

  const dueRecalls = recalls.filter((r) => r.status === 'pending');
  for (const recall of pickN(dueRecalls, Math.min(5, dueRecalls.length))) {
    const patient = patientById.get(recall.patientId);
    notify({
      userId: notifyTarget(null, desk),
      type: 'recall_due',
      title: 'Recall due',
      message: `${patient?.fullName ?? 'A patient'} is due for a ${recall.recallType} recall.`,
      link: '/recalls',
      referenceId: recall.id,
      createdAt: inWindow(at(asDate(recall.dueDate), int(9, 10), int(0, 59)), 60),
    });
  }

  const alertPatients = patients.filter((p) => p.hasAlerts);
  for (const patient of pickN(alertPatients, Math.min(2, alertPatients.length))) {
    notify({
      userId: notifyTarget(null, clinicians),
      type: 'patient_alert',
      title: 'Medical alert added',
      message: `${patient.fullName} has a new medical alert on the record.`,
      link: `/patients/${patient.id}`,
      referenceId: patient.id,
      createdAt: moment(recentOffset(50), 9, 18),
    });
  }

  /* ── Audit trail ────────────────────────────────────────────────────── */

  function audit(spec) {
    rows.push('audit_logs', {
      id: uuid(),
      actorId: spec.actor.id,
      actorEmail: spec.actor.email ?? null,
      action: spec.action,
      entityType: spec.entityType,
      entityId: spec.entityId ?? null,
      patientId: spec.patientId ?? null,
      before: spec.before ?? null,
      after: spec.after ?? null,
      ipAddress: ipAddress(),
      userAgent: pick(USER_AGENTS).slice(0, 255),
      createdAt: dt(notFuture(spec.createdAt)),
      branchId: spec.branchId ?? null,
    });
  }

  /** Someone plausible for the branch — the owner covers every branch. */
  function actorFor(branchId, clinicalOnly = false) {
    const pool = (clinicalOnly && clinicians.length ? clinicians : anyStaff).filter(
      (s) => !s.branchId || !branchId || s.branchId === branchId
    );
    return pick(pool.length ? pool : anyStaff);
  }

  // Logins.
  for (let i = 0; i < 40; i += 1) {
    const actor = pick(anyStaff);
    const when = at(nextClinicDay(day(recentOffset(120))), int(8, 19), int(0, 59));
    audit({
      actor,
      action: 'login',
      entityType: 'admin_user',
      entityId: actor.id,
      branchId: actor.branchId ?? null,
      createdAt: inWindow(when, 120),
    });
  }

  // Patient records.
  for (const patient of pickN(patients, Math.min(26, patients.length))) {
    const actor = actorFor(patient.branchId);
    audit({
      actor,
      action: 'create',
      entityType: 'patient',
      entityId: patient.id,
      patientId: patient.id,
      branchId: patient.branchId,
      after: { mrn: patient.mrn, status: 'active' },
      createdAt: at(day(recentOffset(120)), int(9, 18), int(0, 59)),
    });
  }
  for (const patient of pickN(patients, Math.min(10, patients.length))) {
    const actor = actorFor(patient.branchId);
    audit({
      actor,
      action: 'update',
      entityType: 'patient',
      entityId: patient.id,
      patientId: patient.id,
      branchId: patient.branchId,
      before: { phone: patient.phone },
      after: { phone: mobile(int(900, 999)) },
      createdAt: at(day(recentOffset(90)), int(9, 18), int(0, 59)),
    });
  }

  // Scheduling.
  const APPOINTMENT_FLOWS = [
    ['scheduled', 'confirmed'],
    ['confirmed', 'checked_in'],
    ['checked_in', 'completed'],
    ['scheduled', 'cancelled'],
    ['scheduled', 'no_show'],
  ];
  for (const appt of pickN(appointments, Math.min(36, appointments.length))) {
    const start = asDate(appt.startAt);
    audit({
      actor: actorFor(appt.branchId),
      action: 'create',
      entityType: 'appointment',
      entityId: appt.id,
      patientId: appt.patientId,
      branchId: appt.branchId,
      after: { startAt: dt(start), status: 'scheduled' },
      createdAt: inWindow(at(plusDays(start, -int(1, 14)), int(9, 18), int(0, 59)), 120),
    });
  }
  for (const appt of pickN(appointments, Math.min(30, appointments.length))) {
    const start = asDate(appt.startAt);
    const [before, after] = pick(APPOINTMENT_FLOWS);
    audit({
      actor: actorFor(appt.branchId),
      action: 'update',
      entityType: 'appointment',
      entityId: appt.id,
      patientId: appt.patientId,
      branchId: appt.branchId,
      before: { status: before },
      after: { status: after },
      createdAt: inWindow(at(plusDays(start, -int(0, 2)), int(9, 18), int(0, 59)), 120),
    });
  }

  // Clinical.
  for (const visit of pickN(visits, Math.min(22, visits.length))) {
    audit({
      actor: staffById.get(visit.dentistId) ?? actorFor(visit.branchId, true),
      action: 'create',
      entityType: 'visit',
      entityId: visit.id,
      patientId: visit.patientId,
      branchId: visit.branchId,
      after: { visitDate: dt(asDate(visit.visitDate)), status: visit.status },
      createdAt: inWindow(at(asDate(visit.visitDate), int(10, 18), int(0, 59)), 120),
    });
  }

  // Billing.
  for (const invoice of pickN(invoices, Math.min(22, invoices.length))) {
    audit({
      actor: actorFor(invoice.branchId),
      action: 'create',
      entityType: 'invoice',
      entityId: invoice.id,
      patientId: invoice.patientId,
      branchId: invoice.branchId,
      after: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
      createdAt: at(day(recentOffset(120)), int(10, 19), int(0, 59)),
    });
  }
  const INVOICE_FLOWS = [
    ['unpaid', 'partial'],
    ['partial', 'paid'],
    ['unpaid', 'paid'],
  ];
  for (const invoice of pickN(invoices, Math.min(10, invoices.length))) {
    const [before, after] = pick(INVOICE_FLOWS);
    audit({
      actor: actorFor(invoice.branchId),
      action: 'update',
      entityType: 'invoice',
      entityId: invoice.id,
      patientId: invoice.patientId,
      branchId: invoice.branchId,
      before: { status: before },
      after: { status: after },
      createdAt: at(day(recentOffset(90)), int(10, 19), int(0, 59)),
    });
  }
  for (const payment of pickN(payments, Math.min(22, payments.length))) {
    audit({
      actor: actorFor(payment.branchId ?? null),
      action: 'create',
      entityType: 'payment',
      entityId: payment.id,
      patientId: payment.patientId ?? null,
      branchId: payment.branchId ?? null,
      after: { amount: payment.amount, method: payment.method ?? 'cash' },
      createdAt: at(day(recentOffset(120)), int(10, 19), int(0, 59)),
    });
  }

  // Treatment planning.
  for (const plan of pickN(plans, Math.min(10, plans.length))) {
    audit({
      actor: staffById.get(plan.dentistId) ?? actorFor(plan.branchId, true),
      action: 'create',
      entityType: 'treatment_plan',
      entityId: plan.id,
      patientId: plan.patientId,
      branchId: plan.branchId,
      after: { status: 'draft' },
      createdAt: at(day(recentOffset(120)), int(10, 18), int(0, 59)),
    });
  }
  const PLAN_FLOWS = [
    ['draft', 'proposed'],
    ['proposed', 'accepted'],
    ['accepted', 'in_progress'],
    ['proposed', 'rejected'],
  ];
  for (const plan of pickN(plans, Math.min(8, plans.length))) {
    const [before, after] = pick(PLAN_FLOWS);
    audit({
      actor: staffById.get(plan.dentistId) ?? actorFor(plan.branchId, true),
      action: 'update',
      entityType: 'treatment_plan',
      entityId: plan.id,
      patientId: plan.patientId,
      branchId: plan.branchId,
      before: { status: before },
      after: { status: after },
      createdAt: at(day(recentOffset(90)), int(10, 18), int(0, 59)),
    });
  }

  // Recalls.
  for (const recall of pickN(recalls, Math.min(12, recalls.length))) {
    audit({
      actor: actorFor(recall.branchId),
      action: 'create',
      entityType: 'recall',
      entityId: recall.id,
      patientId: recall.patientId,
      branchId: recall.branchId,
      after: { recallType: recall.recallType, dueDate: dt(asDate(recall.dueDate)) },
      createdAt: at(day(recentOffset(120)), int(10, 18), int(0, 59)),
    });
  }

  // The funnel.
  for (const lead of pickN(leadEntries, Math.min(22, leadEntries.length))) {
    audit({
      actor: staffById.get(lead.assignedTo) ?? pick(anyStaff),
      action: 'create',
      entityType: 'lead',
      entityId: lead.id,
      branchId: lead.branchId,
      after: { source: lead.source, status: 'new' },
      createdAt: plusMinutes(lead.createdAt, int(1, 30)),
    });
  }
  const LEAD_FLOWS = [
    ['new', 'contacted'],
    ['contacted', 'follow_up'],
    ['follow_up', 'qualified'],
    ['qualified', 'converted'],
    ['contacted', 'lost'],
  ];
  for (const lead of pickN(leadEntries, Math.min(14, leadEntries.length))) {
    const [before, after] = pick(LEAD_FLOWS);
    audit({
      actor: staffById.get(lead.assignedTo) ?? pick(anyStaff),
      action: 'update',
      entityType: 'lead',
      entityId: lead.id,
      patientId: lead.convertedPatientId ?? null,
      branchId: lead.branchId,
      before: { status: before },
      after: { status: after },
      createdAt: earliest(plusMinutes(lead.lastActivityAt ?? lead.createdAt, int(5, 240)), TODAY),
    });
  }

  // Chart opens and file downloads are recorded views, on purpose.
  const prescriptionTargets = prescriptions.length
    ? pickN(prescriptions, Math.min(16, prescriptions.length))
    : pickN(patients, Math.min(16, patients.length)).map((p) => ({ id: null, patientId: p.id }));
  for (const target of prescriptionTargets) {
    const patient = patientById.get(target.patientId);
    audit({
      actor: actorFor(patient?.branchId ?? null, true),
      action: 'view',
      entityType: 'prescription',
      entityId: target.id ?? null,
      patientId: target.patientId,
      branchId: patient?.branchId ?? null,
      createdAt: at(day(recentOffset(90)), int(9, 19), int(0, 59)),
    });
  }
  const fileTargets = patientFiles.length
    ? pickN(patientFiles, Math.min(16, patientFiles.length))
    : pickN(patients, Math.min(16, patients.length)).map((p) => ({ id: null, patientId: p.id }));
  for (const target of fileTargets) {
    const patient = patientById.get(target.patientId);
    audit({
      actor: actorFor(patient?.branchId ?? null),
      action: 'view',
      entityType: 'patient_file',
      entityId: target.id ?? null,
      patientId: target.patientId,
      branchId: patient?.branchId ?? null,
      createdAt: at(day(recentOffset(90)), int(9, 19), int(0, 59)),
    });
  }

  // The full export is audited before the stream opens.
  for (let i = 0; i < 2; i += 1) {
    const actor = pick(anyStaff);
    audit({
      actor,
      action: 'export',
      entityType: 'clinic',
      entityId: null,
      branchId: actor.branchId ?? null,
      after: { scope: 'full', format: 'ndjson' },
      createdAt: at(day(recentOffset(70)), int(11, 17), int(0, 59)),
    });
  }
}
