/**
 * Patients, their medical alerts, their files and their portal logins.
 *
 * The roster is written out by hand rather than generated, because several
 * relationships have to hold exactly: eight children need guardians, one
 * parent and child share a portal login, two siblings share a guardian, and
 * `patients.hasAlerts` must mirror the alert conditions row-for-row — the
 * invariants checker compares them directly.
 */
import {
  uuid,
  int,
  pick,
  chance,
  weighted,
  dt,
  dateOnly,
  day,
  at,
  plusMinutes,
  isClinicDay,
  mobile,
  cnic,
} from './context.mjs';

/* ── Roster ───────────────────────────────────────────────────────────── */

/** [firstName, lastName, gender]. Indices 0-33 are Main Branch, 34-47 Gulberg. */
const ROSTER = [
  ['Ahmed', 'Malik', 'male'],
  ['Ayesha', 'Khan', 'female'],
  ['Bilal', 'Chaudhry', 'male'],
  ['Laiba', 'Siddiqui', 'female'],
  ['Fatima', 'Raza', 'female'],
  ['Hassan', 'Butt', 'male'],
  ['Nadia', 'Iqbal', 'female'],
  ['Usman', 'Sheikh', 'male'],
  ['Saba', 'Qureshi', 'female'],
  ['Haris', 'Qureshi', 'male'],
  ['Imran', 'Javed', 'male'],
  ['Rabia', 'Anwar', 'female'],
  ['Kamran', 'Bhatti', 'male'],
  ['Sana', 'Mirza', 'female'],
  ['Momina', 'Farooq', 'female'],
  ['Tariq', 'Nawaz', 'male'],
  ['Hina', 'Aslam', 'female'],
  ['Zeeshan', 'Gondal', 'male'],
  ['Amna', 'Hussain', 'female'],
  ['Salman', 'Akhtar', 'male'],
  ['Sidra', 'Yousaf', 'female'],
  ['Sufyan', 'Mehmood', 'male'],
  ['Faisal', 'Zafar', 'male'],
  ['Mahnoor', 'Ghani', 'female'],
  ['Adnan', 'Khokhar', 'male'],
  ['Iqra', 'Rehman', 'female'],
  ['Waleed', 'Ali', 'male'],
  ['Noor', 'Ahmed', 'female'],
  ['Danish', 'Tariq', 'male'],
  ['Komal', 'Butt', 'female'],
  ['Naveed', 'Bhatti', 'male'],
  ['Areeba', 'Mehmood', 'female'],
  ['Yasir', 'Iqbal', 'male'],
  ['Bushra', 'Javed', 'female'],
  ['Asad', 'Sheikh', 'male'],
  ['Maria', 'Aslam', 'female'],
  ['Zainab', 'Khan', 'female'],
  ['Fahad', 'Rehman', 'male'],
  ['Mehwish', 'Ali', 'female'],
  ['Junaid', 'Hussain', 'male'],
  ['Nimra', 'Raza', 'female'],
  ['Khalid', 'Siddiqui', 'male'],
  ['Ali', 'Farooq', 'male'],
  ['Sadia', 'Malik', 'female'],
  ['Nabeel', 'Anwar', 'male'],
  ['Hafsa', 'Nawaz', 'female'],
  ['Shahzad', 'Iqbal', 'male'],
  ['Rida', 'Ghani', 'female'],
];

const MAIN_COUNT = 34;

const CHILD_INDEXES = new Set([3, 9, 14, 21, 27, 31, 36, 42]);

/** Phone-only adults. With the seven children this leaves 34 of 48 reachable by email. */
const NO_EMAIL_INDEXES = new Set([2, 12, 17, 22, 28, 39, 44]);

/** Registered in the last three weeks — the top of the new-registrations curve. */
const RECENT_INDEXES = new Set([7, 19, 32, 41, 47]);

const PORTAL_INDEXES = [0, 1, 4, 8, 9, 11, 18, 25, 35, 43];

/** 8 is the mother, 9 her son: one login, two linked patients. */
const PORTAL_PARENT = 8;
const PORTAL_CHILD = 9;

const DISCOUNTS = { 6: 20, 34: 20, 10: 10, 23: 10, 38: 10 };

const DISCOUNT_REASONS = {
  6: 'Account: staff family member, 20% standing discount approved by the owner.',
  34: 'Account: staff family member, 20% standing discount approved by the owner.',
  10: 'Account: corporate scheme (Descon Engineering), 10% standing discount.',
  23: 'Account: corporate scheme (Packages Ltd), 10% standing discount.',
  38: 'Account: corporate scheme (Systems Ltd), 10% standing discount.',
};

const STATUS_OVERRIDES = { 26: 'archived', 29: 'inactive', 46: 'inactive' };

/** Referred by an existing patient — the source index is always registered earlier. */
const REFERRED_BY_PATIENT = { 6: 1, 9: 8, 19: 0, 29: 4, 31: 21, 33: 8, 38: 35 };
const REFERRED_BY_GP = new Set([13, 23, 45]);

/** Siblings share a guardian, so 31 reuses whatever 21 was given. */
const GUARDIAN_COPIES = { 31: 21 };

const CITIES = [
  ['Lahore', 7],
  ['Karachi', 1],
  ['Islamabad', 1],
  ['Rawalpindi', 1],
];

const AREAS = [
  'Gulberg III', 'DHA Phase 5', 'Model Town', 'Johar Town', 'Faisal Town',
  'Askari 10', 'Bahria Town', 'Cantt', 'Iqbal Town', 'Garden Town',
  'Wapda Town', 'Valencia Town',
];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const OCCUPATIONS = [
  'Teacher', 'Software engineer', 'Shopkeeper', 'Banker', 'Accountant',
  'Government officer', 'Housewife', 'Student', 'Businessman', 'Pharmacist',
  'Lawyer', 'Driver', 'Textile exporter', 'Nurse', 'Electrician',
  'Bank manager', 'Journalist', 'Architect', 'Retired', 'Sales manager',
];

/** Relations are picked to match the contact's own gender, or the pair reads wrong. */
const MALE_RELATIONS = ['spouse', 'brother', 'father', 'son', 'friend'];
const FEMALE_RELATIONS = ['spouse', 'sister', 'mother', 'daughter', 'friend'];

/** The portal mother has to be a plausible age for an eight-to-twelve year old. */
const AGE_OVERRIDES = { 8: [31, 44] };

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

const GUARDIAN_FIRST_MALE = ['Nasir', 'Rashid', 'Shafiq', 'Anwar', 'Pervez', 'Iftikhar'];
const GUARDIAN_FIRST_FEMALE = ['Shazia', 'Naila', 'Rukhsana', 'Tahira', 'Yasmin', 'Shabana'];

/* ── Conditions ───────────────────────────────────────────────────────── */

/**
 * [conditionType, name, severity, isAlert, status, notes].
 *
 * The eight isAlert rows are the ones the chart banner exists for; everything
 * else is history the dentist wants but does not need shouting about.
 */
const CONDITIONS = {
  0: [
    ['allergy', 'Penicillin allergy', 'severe', 1, 'active',
      'Rash and facial swelling after amoxicillin in 2019. Use clindamycin for prophylaxis.'],
    ['habit', 'Smoker', 'moderate', 0, 'active', 'Around 10 cigarettes a day. Counselled at each recall.'],
  ],
  1: [
    ['habit', 'Bruxism', 'moderate', 0, 'active', 'Night grinding reported by spouse. Wear facets on 16 and 26.'],
  ],
  4: [
    ['dental', 'High caries risk', 'moderate', 0, 'active', 'Frequent sugared tea. Six-monthly fluoride varnish.'],
  ],
  5: [
    ['dental', 'Strong gag reflex', 'moderate', 0, 'active', 'Bitewings poorly tolerated; OPG preferred.'],
  ],
  8: [
    ['dental', 'Previous orthodontic treatment', 'mild', 0, 'resolved',
      'Fixed appliance 2011-2013. Lower fixed retainer 33-43 still bonded.'],
  ],
  10: [
    ['allergy', 'Lactose intolerance', 'mild', 0, 'active', 'Dietary only. No dental relevance beyond chairside drinks.'],
  ],
  11: [
    ['allergy', 'Latex allergy', 'severe', 1, 'active',
      'Contact dermatitis from examination gloves. Nitrile gloves and latex-free dam only.'],
  ],
  13: [
    ['habit', 'Bruxism', 'mild', 0, 'active', 'Soft splint issued 2024. Reviews annually.'],
  ],
  15: [
    ['medical', 'Type 2 diabetes', 'moderate', 1, 'active',
      'Diagnosed 2018. Last HbA1c 7.4%. Morning appointments, watch healing after surgery.'],
    ['medication', 'Metformin 500 mg twice daily', 'mild', 0, 'active', 'Prescribed by physician at Services Hospital.'],
    ['habit', 'Smoker', 'moderate', 0, 'resolved', 'Stopped in 2023 after periodontal treatment.'],
  ],
  17: [
    ['habit', 'Smoker', 'severe', 0, 'active', '20 a day since his twenties.'],
    ['habit', 'Paan and chhalia chewing', 'severe', 0, 'active',
      'Daily. Buccal mucosa checked at every visit for submucous fibrosis.'],
  ],
  18: [
    ['medical', 'Pregnancy (2nd trimester)', 'moderate', 1, 'active',
      'Due March 2027. Elective work deferred; no radiographs without obstetrician clearance.'],
  ],
  22: [
    ['medical', 'Hypertension', 'moderate', 1, 'active',
      'Controlled, around 140/85. Limit adrenaline in local anaesthetic; check BP before surgery.'],
    ['medication', 'Amlodipine 5 mg daily', 'mild', 0, 'active', 'Gingival overgrowth watched at recalls.'],
  ],
  24: [
    ['medication', 'On warfarin (anticoagulant)', 'severe', 1, 'active',
      'For atrial fibrillation. INR within 72 hours before any extraction; do not stop without physician advice.'],
    ['medical', 'Atrial fibrillation', 'moderate', 0, 'active', 'Under cardiology follow-up at Punjab Institute of Cardiology.'],
  ],
  25: [
    ['dental', 'Previous orthodontic treatment', 'mild', 0, 'resolved', 'Aligners 2019-2020. Removable retainer worn nightly.'],
  ],
  27: [
    ['medical', 'Asthma', 'moderate', 1, 'active',
      'Inhaler must be with her in the surgery. Avoid aspirin; rinse after steroid inhaler.'],
  ],
  33: [
    ['medical', 'Hypothyroidism', 'mild', 0, 'active', 'Stable on replacement, reviewed yearly.'],
    ['medication', 'Levothyroxine 75 mcg daily', 'mild', 0, 'active', 'Taken before breakfast.'],
  ],
  37: [
    ['dental', 'Strong gag reflex', 'mild', 0, 'active', 'Manages with slow seating of impression trays.'],
  ],
  40: [
    ['medical', 'Epilepsy', 'severe', 1, 'active',
      'Generalised seizures, last one 2024. Keep chair low, avoid long sessions, know the rescue protocol.'],
  ],
};

/* ── Files ────────────────────────────────────────────────────────────── */

const FILE_MEDIA = {
  xray: ['xrays', 'image/jpeg', 'jpg'],
  photo: ['photos', 'image/jpeg', 'jpg'],
  scan: ['scans', 'image/png', 'png'],
  document: ['documents', 'application/pdf', 'pdf'],
  consent: ['consents', 'application/pdf', 'pdf'],
  report: ['reports', 'application/pdf', 'pdf'],
};

/** `pair` builds two photo rows sharing a pairId, one before and one after. */
const FILE_SPECS = [
  { p: 0, type: 'xray', tooth: '46', title: 'Periapical 46 — pre-op' },
  { p: 0, type: 'photo', title: 'Intraoral photo, lower right quadrant' },
  { p: 0, type: 'consent', title: 'Root canal treatment consent' },
  { p: 1, type: 'xray', title: 'OPG — full mouth survey' },
  { p: 1, type: 'document', title: 'Medical history form (signed)' },
  { p: 4, pair: 'Whitening — upper anteriors' },
  { p: 4, type: 'xray', tooth: '11', title: 'Periapical 11' },
  { p: 5, type: 'xray', tooth: '16', title: 'Periapical 16' },
  { p: 8, type: 'report', title: 'Orthodontic assessment report' },
  { p: 10, type: 'xray', tooth: '36', title: 'Periapical 36' },
  { p: 11, type: 'consent', title: 'Latex-free protocol acknowledgement' },
  // Filed under a patient REFERRED_BY_GP actually marks as GP-referred.
  { p: 13, type: 'document', title: 'Referral letter — Dr. Faisal (GP)' },
  { p: 13, type: 'scan', title: 'Intraoral scan — upper arch' },
  { p: 13, type: 'xray', tooth: '37', title: 'Periapical 37' },
  { p: 15, type: 'report', title: 'HbA1c laboratory report' },
  { p: 15, type: 'document', title: 'Physician fitness letter' },
  { p: 18, type: 'document', title: 'Obstetrician clearance note' },
  { p: 22, type: 'xray', title: 'OPG — periodontal assessment' },
  { p: 23, pair: 'Anterior crowns — shade match' },
  { p: 23, type: 'consent', title: 'Crown preparation consent' },
  { p: 25, type: 'xray', tooth: '47', title: 'Periapical 47' },
  { p: 33, type: 'report', title: 'Thyroid function report' },
  { p: 35, pair: 'Fixed appliance — debond' },
  { p: 35, type: 'xray', title: 'OPG — orthodontic records' },
  // Filed under a patient DISCOUNTS actually puts on a corporate scheme.
  { p: 38, type: 'document', title: 'Employer letter for corporate billing' },
  { p: 40, type: 'consent', title: 'Sedation and seizure protocol consent' },
  { p: 40, type: 'document', title: 'Neurologist letter' },
];

/* ── Build ────────────────────────────────────────────────────────────── */

export default function build(world, rows) {
  const mainBranch = world.branches.find((b) => b.isMain) ?? world.branches[0];
  const secondBranch =
    world.branches.find((b) => b.code === 'GLB') ??
    world.branches.find((b) => b.id !== mainBranch.id) ??
    mainBranch;

  const owner = world.staff.find((s) => s.staffType === 'owner') ?? world.staff[0];
  const receptionists = world.staff.filter((s) => s.staffType === 'receptionist');
  const clinicians = world.staff.filter(
    (s) => s.isClinical || ['owner', 'dentist', 'hygienist'].includes(s.staffType)
  );
  const uploaders = clinicians.length ? clinicians : [owner];

  // MRN sequences restart per branch code, exactly as nextMrn() does.
  const mrnSeq = new Map();
  const nextMrn = (code) => {
    const n = (mrnSeq.get(code) ?? 0) + 1;
    mrnSeq.set(code, n);
    return `${code}-${String(n).padStart(6, '0')}`;
  };

  const registrarFor = (branchId) => {
    const local = receptionists.filter((s) => s.branchId === branchId || !s.branchId);
    const pool = local.length ? local : receptionists;
    if (!pool.length) return owner.id;
    return chance(0.85) ? pick(pool).id : owner.id;
  };

  const entries = [];
  const guardians = {};

  ROSTER.forEach(([firstName, lastName, gender], i) => {
    const branch = i < MAIN_COUNT ? mainBranch : secondBranch;
    const isChild = CHILD_INDEXES.has(i);
    const fullName = `${firstName} ${lastName}`;

    /* Registration date. The curve leans recent so the new-registrations
       report climbs; five patients sit inside the last three weeks. */
    let regDays;
    if (RECENT_INDEXES.has(i)) {
      regDays = int(2, 20);
    } else {
      const band = weighted([['near', 4], ['mid', 3], ['far', 2]]);
      regDays = band === 'near' ? int(30, 150) : band === 'mid' ? int(151, 400) : int(401, 700);
    }
    /* A patient cannot be referred by someone who was not yet a patient.
       Roster order is not date order — regDays is drawn independently — so
       pull the referred patient forward until they register after the person
       who sent them. */
    const referrerDays = entries[REFERRED_BY_PATIENT[i]]?.regDays;
    if (referrerDays !== undefined && regDays >= referrerDays) {
      regDays = Math.max(2, referrerDays - int(7, 60));
    }
    if (!isClinicDay(day(-regDays))) regDays += 1;
    const registeredAt = at(day(-regDays), int(9, 18), pick([0, 5, 10, 15, 20, 30, 40, 45, 50]));

    const ageBand = AGE_OVERRIDES[i];
    const ageYears = ageBand
      ? int(ageBand[0], ageBand[1])
      : isChild
        ? int(4, 12)
        : weighted([[int(18, 30), 3], [int(31, 45), 5], [int(46, 60), 3], [int(61, 70), 2]]);
    const dob = day(-(ageYears * 365 + int(0, 364)));

    let guardianName = null;
    let guardianRelation = null;
    if (isChild) {
      const copyFrom = GUARDIAN_COPIES[i];
      const fatherly = chance(0.6);
      if (copyFrom !== undefined && guardians[copyFrom]) {
        ({ name: guardianName, relation: guardianRelation } = guardians[copyFrom]);
      } else if (i === PORTAL_CHILD) {
        guardianName = entries[PORTAL_PARENT].fullName;
        guardianRelation = entries[PORTAL_PARENT].gender === 'female' ? 'mother' : 'father';
      } else if (fatherly) {
        guardianName = `${pick(GUARDIAN_FIRST_MALE)} ${lastName}`;
        guardianRelation = 'father';
      } else {
        guardianName = `${pick(GUARDIAN_FIRST_FEMALE)} ${lastName}`;
        guardianRelation = 'mother';
      }
      guardians[i] = { name: guardianName, relation: guardianRelation };
    }

    let email = null;
    if (i === PORTAL_CHILD) {
      email = entries[PORTAL_PARENT].email;
    } else if (!isChild && !NO_EMAIL_INDEXES.has(i)) {
      email = `${firstName}.${lastName}${i + 1}@${pick(EMAIL_DOMAINS)}`.toLowerCase();
    }

    const referredBy = REFERRED_BY_GP.has(i)
      ? 'Dr. Faisal (GP)'
      : REFERRED_BY_PATIENT[i] !== undefined
        ? entries[REFERRED_BY_PATIENT[i]].fullName
        : null;

    const conditionSpecs = CONDITIONS[i] ?? [];
    const hasAlerts = conditionSpecs.some(([, , , isAlert, status]) => isAlert === 1 && status === 'active');

    const contactIsMale = chance(0.5);
    const emergencyName = isChild
      ? guardianName
      : `${contactIsMale ? pick(GUARDIAN_FIRST_MALE) : pick(GUARDIAN_FIRST_FEMALE)} ${lastName}`;
    /* Same-gender contacts are never the spouse — that pair reads wrong. */
    const relationPool = (contactIsMale ? MALE_RELATIONS : FEMALE_RELATIONS).filter(
      (r) => r !== 'spouse' || contactIsMale !== (gender === 'male')
    );
    const emergencyRelation = isChild ? guardianRelation : pick(relationPool);
    const wantsEmergency = isChild || chance(0.55);

    // The portal child lives with the parent whose login also reaches him.
    const family = i === PORTAL_CHILD ? entries[PORTAL_PARENT] : null;

    const address = family
      ? family.address
      : `House ${int(1, 480)}, Street ${int(1, 40)}, ${pick(AREAS)}`;
    const city = family ? family.city : weighted(CITIES);

    const medicalNotes = DISCOUNT_REASONS[i] ?? null;
    const dentalNotes = isChild
      ? 'Mixed dentition. Chart primary teeth; parent present for all treatment.'
      : null;

    const id = uuid();
    const row = rows.push('patients', {
      id,
      mrn: nextMrn(branch.code),
      branchId: branch.id,
      firstName,
      lastName,
      gender,
      dateOfBirth: dateOnly(dob),
      cnic: isChild ? null : cnic(100 + i),
      phone: mobile(100 + i),
      altPhone: family ? family.phone : !isChild && chance(0.25) ? mobile(700 + i) : null,
      email,
      address,
      city,
      emergencyContactName: wantsEmergency ? emergencyName : null,
      emergencyContactPhone: wantsEmergency ? mobile(500 + i) : null,
      emergencyContactRelation: wantsEmergency ? emergencyRelation : null,
      guardianName,
      bloodGroup: chance(0.58) ? pick(BLOOD_GROUPS) : null,
      occupation: isChild ? null : pick(OCCUPATIONS),
      referredBy,
      leadId: null, // module 07 writes this back when it converts a lead
      defaultDiscountPercent: DISCOUNTS[i] ?? 0,
      medicalNotes,
      dentalNotes,
      hasAlerts: hasAlerts ? 1 : 0,
      portalUserId: null,
      status: STATUS_OVERRIDES[i] ?? 'active',
      registeredBy: registrarFor(branch.id),
      createdAt: dt(registeredAt),
      updatedAt: dt(registeredAt),
    });

    entries.push({
      id,
      mrn: row.mrn,
      branchId: branch.id,
      firstName,
      lastName,
      fullName,
      gender,
      dobIso: dateOnly(dob).slice(0, 10),
      phone: row.phone,
      email,
      address,
      city,
      isChild,
      hasAlerts,
      portalUserId: null,
      createdAtDate: registeredAt,
      regDays,
      row,
    });
  });

  /* Conditions. Recorded shortly after registration, which is when the
     medical history form is actually taken. */
  for (const [key, specs] of Object.entries(CONDITIONS)) {
    const entry = entries[Number(key)];
    for (const [conditionType, name, severity, isAlert, status, notes] of specs) {
      const recordedAt = plusMinutes(entry.createdAtDate, int(20, 180));
      rows.push('patient_conditions', {
        id: uuid(),
        patientId: entry.id,
        conditionType,
        name,
        severity,
        isAlert,
        notes,
        status,
        recordedBy: pick(uploaders).id,
        createdAt: dt(recordedAt),
        updatedAt: dt(recordedAt),
      });
    }
  }

  /* Files. visitId stays NULL — module 04 owns visits and has no way back
     to these rows. */
  /** Days before TODAY, always after the patient registered and never a Sunday. */
  const fileDaysAgo = (entry) => {
    let ago = int(1, Math.max(2, entry.regDays - 2));
    if (!isClinicDay(day(-ago))) ago = Math.min(ago + 1, Math.max(1, entry.regDays - 1));
    return ago;
  };

  const fileTime = (ago) => at(day(-ago), int(9, 18), pick([0, 15, 30, 45]));

  const pushFile = (entry, type, extra) => {
    const [folder, mimeType, ext] = FILE_MEDIA[type];
    const createdAt = extra.createdAt ?? fileTime(fileDaysAgo(entry));
    return rows.push('patient_files', {
      id: uuid(),
      patientId: entry.id,
      visitId: null,
      toothNumber: extra.tooth ?? null,
      fileType: type,
      photoStage: extra.photoStage ?? null,
      pairId: extra.pairId ?? null,
      title: extra.title,
      storageKey: `patients/${entry.id}/${folder}/${uuid()}.${ext}`,
      mimeType,
      sizeBytes: ext === 'pdf' ? int(180000, 900000) : int(400000, 2400000),
      uploadedBy: pick(uploaders).id,
      createdAt: dt(createdAt),
    });
  };

  for (const spec of FILE_SPECS) {
    const entry = entries[spec.p];
    if (spec.pair) {
      const pairId = uuid();
      const beforeAgo = fileDaysAgo(entry);
      // Fewer days ago is later, so the after shot always follows the before shot.
      let afterAgo = Math.max(1, beforeAgo - int(14, 90));
      if (!isClinicDay(day(-afterAgo))) afterAgo = Math.max(1, afterAgo - 1);
      pushFile(entry, 'photo', {
        title: `${spec.pair} — before`,
        photoStage: 'before',
        pairId,
        createdAt: fileTime(beforeAgo),
      });
      pushFile(entry, 'photo', {
        title: `${spec.pair} — after`,
        photoStage: 'after',
        pairId,
        createdAt: fileTime(afterAgo),
      });
    } else {
      pushFile(entry, spec.type, { title: spec.title, tooth: spec.tooth });
    }
  }

  /* Portal logins. Nine `user` rows for ten patients: the mother's login
     also reaches her son, which is what the portal switcher is for. */
  const portalUsers = [];
  for (const i of PORTAL_INDEXES) {
    if (i === PORTAL_CHILD) continue;
    const entry = entries[i];
    const linked = i === PORTAL_PARENT ? [entry, entries[PORTAL_CHILD]] : [entry];
    const earliest = linked.reduce((min, e) => Math.min(min, e.regDays), Infinity);
    const signedUpAt = at(day(-int(1, Math.max(1, earliest - 1))), int(9, 21), int(0, 59));

    const userId = uuid();
    rows.push('user', {
      id: userId,
      name: entry.fullName,
      first_name: entry.firstName,
      last_name: entry.lastName,
      email: entry.email,
      phone: entry.phone,
      created_at: dt(signedUpAt),
      updated_at: dt(signedUpAt),
    });

    for (const e of linked) {
      e.portalUserId = userId;
      e.row.portalUserId = userId;
    }

    portalUsers.push({ id: userId, email: entry.email, patientIds: linked.map((e) => e.id) });
  }

  world.patients = entries.map((e) => ({
    id: e.id,
    mrn: e.mrn,
    branchId: e.branchId,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: e.fullName,
    gender: e.gender,
    dobIso: e.dobIso,
    phone: e.phone,
    email: e.email,
    isChild: e.isChild,
    hasAlerts: e.hasAlerts,
    portalUserId: e.portalUserId,
    createdAtDate: e.createdAtDate,
    row: e.row,
  }));

  world.portalUsers = portalUsers;
}
