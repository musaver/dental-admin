import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { patients } from '@/lib/schema';
import { withAuth, resolveBranchScope, resolveWritingBranch } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { PATIENT_STATUS } from '@/lib/enums';
import { findDuplicatePatients, isDuplicateKeyError, normalizePhone } from '@/lib/patients';
import { branchExists, insertPatient, MRN_RETRIES } from '@/lib/patient-registration';
import { patientCreateSchema, validationError } from '@/lib/validation/patient';
import { parsePageParams, parseSearch, paginate } from '@/lib/pagination';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

export const GET = withAuth(PERMISSIONS.PATIENTS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const search = parseSearch(url);
  const status = url.searchParams.get('status');
  const id = url.searchParams.get('id');

  const filters = [];

  if (branchIds) filters.push(inArray(patients.branchId, branchIds));

  // Resolve one patient into the picker projection. GET /api/patients/[id]
  // would also do it, but that route records a chart view — which is the right
  // thing for opening a record and wrong for filling in a dropdown.
  if (id) filters.push(eq(patients.id, id));

  // Default to hiding archived records; the list is a working view. An explicit
  // id is not a working view, so it resolves whatever status the patient is in.
  if (status && status !== 'all') {
    filters.push(eq(patients.status, status));
  } else if (!status && !id) {
    filters.push(inArray(patients.status, [PATIENT_STATUS.ACTIVE, PATIENT_STATUS.INACTIVE]));
  }

  if (search) {
    // Search the three things staff actually have to hand: the MRN on a
    // printed record, a name, or the number the patient is calling from.
    const digits = search.replace(/\D/g, '');
    const conditions = [
      like(patients.mrn, `%${search}%`),
      like(patients.firstName, `%${search}%`),
      like(patients.lastName, `%${search}%`),
    ];
    if (digits.length >= 4) {
      conditions.push(
        sql`REGEXP_REPLACE(${patients.phone}, '[^0-9]', '') LIKE ${`%${digits}%`}`
      );
    }
    filters.push(or(...conditions)!);
  }

  const where = filters.length ? and(...filters) : undefined;

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: patients.id,
        mrn: patients.mrn,
        firstName: patients.firstName,
        lastName: patients.lastName,
        phone: patients.phone,
        email: patients.email,
        gender: patients.gender,
        dateOfBirth: patients.dateOfBirth,
        status: patients.status,
        hasAlerts: patients.hasAlerts,
        branchId: patients.branchId,
        createdAt: patients.createdAt,
      })
      .from(patients)
      .where(where)
      .orderBy(desc(patients.createdAt))
      .limit(page.pageSize)
      .offset(page.offset),
    db.select({ n: sql<number>`count(*)` }).from(patients).where(where),
  ]);

  return NextResponse.json(paginate(rows, Number(counted?.n ?? 0), page));
});

export const POST = withAuth(PERMISSIONS.PATIENTS_CREATE, async (req, ctx) => {
  const parsed = patientCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(validationError(parsed.error), { status: 400 });
  }
  const input = parsed.data;

  // Head office must say which branch; scoped staff always use their own.
  const branchId = resolveWritingBranch(ctx, input.branchId);
  if (!branchId) {
    return NextResponse.json(
      { error: 'Choose which branch is registering this patient.', details: { branchId: ['Required'] } },
      { status: 400 }
    );
  }

  if (!(await branchExists(branchId))) {
    return NextResponse.json({ error: 'That branch does not exist.' }, { status: 400 });
  }

  const phone = normalizePhone(input.phone)!;

  // Advisory, not blocking: names repeat and families share numbers, so a
  // human decides. Registering the same person twice splits their clinical
  // history in a way nothing else will ever flag.
  if (!input.allowDuplicate) {
    const duplicates = await findDuplicatePatients(
      {
        phone,
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
      },
      { branchIds: ctx.isHeadOffice ? null : [ctx.branchId!] }
    );
    if (duplicates.length) {
      return NextResponse.json(
        {
          error: 'This may already be an existing patient.',
          code: 'POSSIBLE_DUPLICATE',
          duplicates,
        },
        { status: 409 }
      );
    }
  }

  const now = clinicNow();

  for (let attempt = 1; attempt <= MRN_RETRIES; attempt++) {
    try {
      const created = await db.transaction((tx) =>
        insertPatient(tx, { input, branchId, actor: ctx, now, request: req })
      );

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      // Another registration took the same number between our read and write.
      if (isDuplicateKeyError(error) && attempt < MRN_RETRIES) continue;
      throw error;
    }
  }

  return NextResponse.json(
    { error: 'Could not allocate a medical record number. Please try again.' },
    { status: 409 }
  );
});
