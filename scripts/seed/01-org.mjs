import { uuid, at, day, dt, mobile } from './context.mjs';

/**
 * The organisation: branches, chairs, staff, rosters, leave, template
 * overrides and per-user preferences.
 *
 * Everything later in the seed hangs off `world.staff` and `world.branches`,
 * so this module runs first. The Main Branch and the owner already exist in
 * the database — they are registered on `world`, never re-inserted.
 */

const MAIN_BRANCH_ID = '54b330c3-8df1-4b53-8a04-aa820aefcd96';
const OWNER_ID = '185fcba5-e9a4-44c7-aa6b-4a31a1f0116d';

const ROLE = {
  OWNER: 'fef3da94-6ee1-4b16-9dc1-350204bded8f',
  DENTIST: '303ad41f-35c1-4a63-973e-03bbc3968c6f',
  RECEPTIONIST: '610f000c-4e5a-4993-8fe5-0edaca369a19',
  ASSISTANT: '68ec3bdb-a428-44d9-b973-31903d32f6ed',
  MANAGER: 'd5500243-2dbc-4803-b736-4c42f3112595',
};

const ROLE_NAME = {
  [ROLE.OWNER]: 'Admin / Owner',
  [ROLE.DENTIST]: 'Dentist',
  [ROLE.RECEPTIONIST]: 'Receptionist',
  [ROLE.ASSISTANT]: 'Assistant',
  [ROLE.MANAGER]: 'Manager',
};

/** One password for the whole demo, so the printed login list stays short. */
const DEMO_PASSWORD = 'DentalDemo!2026';

/** staffType values that later modules may book as the dentist on a visit. */
const CLINICAL_TYPES = ['owner', 'dentist', 'hygienist'];

const MON_SAT = [1, 2, 3, 4, 5, 6];
const MON_FRI = [1, 2, 3, 4, 5];

export default function build(world, rows) {
  /* ── Branches ───────────────────────────────────────────────────────── */

  world.branches = world.branches ?? [];

  let main = world.branches.find((b) => b.id === MAIN_BRANCH_ID);
  if (!main) {
    main = { id: MAIN_BRANCH_ID, name: 'Main Branch', code: 'MAIN' };
    world.branches.push(main);
  }
  main.city = main.city ?? 'Lahore';
  main.isMain = true;

  const gulbergId = uuid();
  const gulbergRow = rows.push('branches', {
    id: gulbergId,
    name: 'Gulberg Branch',
    code: 'GLB',
    address: '12-C, Main Boulevard, Gulberg III, Lahore',
    city: 'Lahore',
    phone: '+924235771200',
    email: 'gulberg@dentaldemo.pk',
    timezone: 'Asia/Karachi',
    isActive: 1,
  });

  const gulberg = {
    id: gulbergId,
    name: 'Gulberg Branch',
    code: 'GLB',
    city: 'Lahore',
    isMain: false,
    row: gulbergRow,
  };
  world.branches.push(gulberg);

  /* ── Chairs ─────────────────────────────────────────────────────────── */

  world.chairs = world.chairs ?? [];

  const addChair = (branchId, name) => {
    const id = uuid();
    const row = rows.push('chairs', { id, branchId, name, isActive: 1 });
    const chair = { id, branchId, name, row };
    world.chairs.push(chair);
    return chair;
  };

  addChair(MAIN_BRANCH_ID, 'Chair 3');
  addChair(gulbergId, 'Chair 1');
  addChair(gulbergId, 'Chair 2');

  /* ── Staff ──────────────────────────────────────────────────────────── */

  world.staff = world.staff ?? [];

  let owner = world.staff.find((s) => s.id === OWNER_ID);
  if (!owner) {
    owner = {
      id: OWNER_ID,
      name: 'Owner',
      email: 'musaverleo@gmail.com',
      staffType: 'owner',
      branchId: null,
    };
    world.staff.push(owner);
  }
  owner.roleId = ROLE.OWNER;
  owner.roleName = ROLE_NAME[ROLE.OWNER];
  owner.isClinical = true;
  // Boolean on `world`, tinyint in the row. Downstream modules guard with
  // `isActive !== false`, which a numeric 0 passes silently.
  owner.isActive = true;

  let phoneIndex = 0;
  const addStaff = ({ firstName, name, roleId, branchId, staffType, licenseNumber, isActive = 1 }) => {
    const id = uuid();
    phoneIndex += 1;
    const email = `${firstName.toLowerCase()}@dentaldemo.pk`;
    const row = rows.push('admin_users', {
      id,
      email,
      // The runner bcrypt-hashes anything prefixed 'plain:'.
      password: `plain:${DEMO_PASSWORD}`,
      name,
      roleId,
      branchId,
      phone: mobile(phoneIndex),
      staffType,
      licenseNumber: licenseNumber ?? null,
      signatureUrl: null,
      isActive,
    });
    const entry = {
      id,
      name,
      email,
      password: DEMO_PASSWORD,
      roleId,
      roleName: ROLE_NAME[roleId],
      branchId,
      staffType,
      isClinical: CLINICAL_TYPES.includes(staffType),
      // The row carries the tinyint; `world` carries a boolean. Every later
      // module filters with `isActive !== false`, and 0 !== false is true —
      // a numeric 0 here would put deactivated staff back to work.
      isActive: isActive === 1,
      row,
    };
    world.staff.push(entry);
    return entry;
  };

  const ayesha = addStaff({
    firstName: 'Ayesha',
    name: 'Dr. Ayesha Khan',
    roleId: ROLE.DENTIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'dentist',
    licenseNumber: 'PMDC-12345-D',
  });

  const bilal = addStaff({
    firstName: 'Bilal',
    name: 'Dr. Bilal Chaudhry',
    roleId: ROLE.DENTIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'dentist',
    licenseNumber: 'PMDC-23417-D',
  });

  const hina = addStaff({
    firstName: 'Hina',
    name: 'Dr. Hina Malik',
    roleId: ROLE.DENTIST,
    branchId: gulbergId,
    staffType: 'dentist',
    licenseNumber: 'PMDC-31882-D',
  });

  const sana = addStaff({
    firstName: 'Sana',
    name: 'Dr. Sana Qureshi (Orthodontist)',
    roleId: ROLE.DENTIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'dentist',
    licenseNumber: 'PMDC-40655-D',
  });

  // A hygienist is clinical and bookable, but is not addressed as "Dr.".
  const maria = addStaff({
    firstName: 'Maria',
    name: 'Maria Siddiqui',
    roleId: ROLE.DENTIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'hygienist',
    licenseNumber: 'PMDC-51204-H',
  });

  const nimra = addStaff({
    firstName: 'Nimra',
    name: 'Nimra Yousaf',
    roleId: ROLE.RECEPTIONIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'receptionist',
  });

  const komal = addStaff({
    firstName: 'Komal',
    name: 'Komal Farooq',
    roleId: ROLE.RECEPTIONIST,
    branchId: gulbergId,
    staffType: 'receptionist',
  });

  addStaff({
    firstName: 'Hamza',
    name: 'Hamza Iqbal',
    roleId: ROLE.ASSISTANT,
    branchId: MAIN_BRANCH_ID,
    staffType: 'assistant',
  });

  addStaff({
    firstName: 'Rabia',
    name: 'Rabia Nawaz',
    roleId: ROLE.ASSISTANT,
    branchId: gulbergId,
    staffType: 'assistant',
  });

  const kamran = addStaff({
    firstName: 'Kamran',
    name: 'Kamran Sheikh',
    roleId: ROLE.MANAGER,
    branchId: MAIN_BRANCH_ID,
    staffType: 'manager',
  });

  // Left the clinic. Staff are never hard-deleted, so the deactivation path
  // has something real to render.
  addStaff({
    firstName: 'Sidra',
    name: 'Sidra Anwar',
    roleId: ROLE.RECEPTIONIST,
    branchId: MAIN_BRANCH_ID,
    staffType: 'receptionist',
    isActive: 0,
  });

  /* ── Rosters ────────────────────────────────────────────────────────── */

  const roster = (staff, branchId, days, startTime, endTime) => {
    for (const dow of days) {
      rows.push('staff_schedules', {
        id: uuid(),
        staffId: staff.id,
        branchId,
        dayOfWeek: dow,
        startTime,
        endTime,
        isActive: 1,
      });
    }
  };

  // The owner has no home branch, so their clinical sessions sit at Main.
  roster(owner, MAIN_BRANCH_ID, MON_SAT, '09:00', '21:00');
  roster(ayesha, MAIN_BRANCH_ID, MON_SAT, '09:00', '15:00');
  // Bilal works evenings and takes Saturday off.
  roster(bilal, MAIN_BRANCH_ID, MON_FRI, '15:00', '21:00');
  roster(sana, MAIN_BRANCH_ID, MON_SAT, '15:00', '21:00');
  roster(maria, MAIN_BRANCH_ID, MON_SAT, '09:00', '15:00');
  roster(hina, gulbergId, MON_SAT, '10:00', '19:00');

  roster(nimra, MAIN_BRANCH_ID, MON_SAT, '09:00', '16:00');
  roster(komal, gulbergId, MON_SAT, '13:00', '21:00');

  /* ── Time off ───────────────────────────────────────────────────────── */

  // Half-open at query time (startDate < rangeEnd AND endDate > rangeStart),
  // so the end is stamped late on the last day rather than at its midnight.
  // Also registered on `world` so the diary can avoid booking someone who is
  // away — lib/availability.ts subtracts these windows, and an appointment
  // sitting inside one reads as a bug on the rota screen.
  world.timeOff = world.timeOff ?? [];

  const leave = (staff, fromDay, toDay, reason) => {
    const from = at(day(fromDay), 0, 0);
    const to = at(day(toDay), 23, 59);
    rows.push('staff_time_off', {
      id: uuid(),
      staffId: staff.id,
      startDate: dt(from),
      endDate: dt(to),
      reason,
    });
    world.timeOff.push({ staffId: staff.id, start: from, end: to, reason });
  };

  leave(ayesha, -40, -33, 'Annual leave');
  leave(bilal, 9, 12, 'Conference — IDS Karachi');
  leave(hina, 20, 27, 'Annual leave');

  /* ── Message template overrides ─────────────────────────────────────── */

  // Branch-level rewordings of the code registry in lib/comm-templates.ts.
  // Only keys the code defines, and only variables those keys declare.
  const template = (templateKey, subject, bodyHtml) => {
    rows.push('message_templates', {
      id: uuid(),
      branchId: MAIN_BRANCH_ID,
      templateKey,
      subject,
      bodyHtml,
      isActive: 1,
      updatedBy: OWNER_ID,
    });
  };

  template(
    'appointment_reminder',
    'See you tomorrow at {{clinicName}} — {{dateTime}}',
    `<p>Dear {{patientName}},</p>
<p>This is a reminder of your appointment on <strong>{{dateTime}}</strong> with
   {{dentistName}} at our Main Branch.</p>
<p>Please arrive ten minutes early. If the time no longer suits you, call
   {{clinicPhone}} so we can offer it to someone on the waiting list.</p>`
  );

  template(
    'recall_due',
    'Your {{recallType}} check-up is due',
    `<p>Dear {{patientName}},</p>
<p>Our records show your {{recallType}} review at {{clinicName}} is now due.</p>
<p>Call {{clinicPhone}} and we will find you a slot that fits around your week.</p>`
  );

  template(
    'payment_reminder',
    'Invoice {{invoiceNumber}} — Rs {{balance}} outstanding',
    `<p>Dear {{patientName}},</p>
<p>Invoice <strong>{{invoiceNumber}}</strong> still shows a balance of
   <strong>{{balance}}</strong>.</p>
<p>You can pay at reception by cash, card, Easypaisa or JazzCash. If anything on
   the invoice looks wrong, call {{clinicPhone}} and we will check it for you.</p>`
  );

  template(
    'portal_invite',
    'Your {{clinicName}} portal account is ready',
    `<p>Dear {{patientName}},</p>
<p>Your appointments, treatment plans and invoices are now available online.</p>
<p><a href="{{activateLink}}">Activate your account</a></p>
<p>The link is personal to you and expires in seven days.</p>`
  );

  /* ── User preferences ───────────────────────────────────────────────── */

  const pref = (staffId, prefKey, value, createdOn) => {
    rows.push('user_preferences', {
      id: uuid(),
      adminUserId: staffId,
      prefKey,
      value,
      createdAt: dt(at(day(createdOn), 9, 30)),
    });
  };

  // Widget names match the sections app/api/dashboard/route.ts returns.
  pref(OWNER_ID, 'dashboard', {
    widgets: ['today', 'outstanding', 'week', 'recallsDue', 'leadsDue'],
  }, -120);

  pref(kamran.id, 'dashboard', {
    widgets: ['today', 'outstanding', 'activePatients', 'leadsDue'],
  }, -75);

  pref(nimra.id, 'dashboard', {
    widgets: ['today', 'recallsDue', 'leadsDue'],
  }, -50);

  /* ── Login list ─────────────────────────────────────────────────────── */

  const branchName = (branchId) =>
    branchId === gulbergId ? 'Gulberg Branch' : branchId === MAIN_BRANCH_ID ? 'Main Branch' : 'All branches';

  world.credentials = world.staff
    .filter((s) => s.password)
    .map((s) => ({
      email: s.email,
      password: s.password,
      role: s.isActive ? s.roleName : `${s.roleName} (deactivated)`,
      branch: branchName(s.branchId),
    }));
}
