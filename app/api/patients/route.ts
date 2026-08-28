import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { branches, patients } from '@/lib/schema';
import { withAuth, resolveBranchScope, AuthError, AUTH_FAILURE } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, PATIENT_STATUS } from '@/lib/enums';
import {
  findDuplicatePatients,
  isDuplicateKeyError,
  nextMrn,
  normalizePhone,
} from '@/lib/patients';
import { patientCreateSchema, validationError } from '@/lib/validation/patient';
import { parsePageParams, parseSearch, paginate } from '@/lib/pagination';
import { clinicNow } from '@/lib/datetime';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/** MRN generation races on a shared read; the unique index catches it. */
const MRN_RETRIES = 5;

export const GET = withAuth(PERMISSIONS.PATIENTS_VIEW, async (req, ctx) => {
  const url = new URL(req.url);
  const { branchIds } = resolveBranchScope(ctx, url.searchParams.get('branchId'));
  const page = parsePageParams(url);
  const search = parseSearch(url);
  const status = url.searchParams.get('status');

  const filters = [];

  if (branchIds) filters.push(inArray(patients.branchId, branchIds));

  // Default to hiding archived records; the list is a working view.
  if (status && status !== 'all') {
    filters.push(eq(patients.status, status));
  } else if (!status) {
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
  const branchId = ctx.isHeadOffice ? input.branchId : ctx.branchId;
  if (!branchId) {
    return NextResponse.json(
      { error: 'Choose which branch is registering this patient.', details: { branchId: ['Required'] } },
      { status: 400 }
    );
  }
  if (!ctx.isHeadOffice && input.branchId && input.branchId !== ctx.branchId) {
    throw new AuthError(AUTH_FAILURE.FORBIDDEN, 403, 'You cannot register into another branch.');
  }

  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) {
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
      const created = await db.transaction(async (tx) => {
        const mrn = await nextMrn(tx, branchId);
        const row = {
          id: uuidv4(),
          mrn,
          branchId,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          gender: input.gender ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          cnic: input.cnic ?? null,
          phone,
          altPhone: normalizePhone(input.altPhone),
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: normalizePhone(input.emergencyContactPhone),
          emergencyContactRelation: input.emergencyContactRelation ?? null,
          guardianName: input.guardianName ?? null,
          bloodGroup: input.bloodGroup ?? null,
          occupation: input.occupation ?? null,
          referredBy: input.referredBy ?? null,
          leadId: input.leadId ?? null,
          defaultDiscountPercent: input.defaultDiscountPercent ?? 0,
          medicalNotes: input.medicalNotes ?? null,
          dentalNotes: input.dentalNotes ?? null,
          hasAlerts: false,
          portalUserId: null,
          status: PATIENT_STATUS.ACTIVE,
          registeredBy: ctx.userId,
          createdAt: now,
          updatedAt: now,
        };

        await tx.insert(patients).values(row);

        await writeAuditLog(
          {
            actor: ctx,
            action: AUDIT_ACTION.CREATE,
            entityType: AUDIT_ENTITY.PATIENT,
            entityId: row.id,
            patientId: row.id,
            branchId,
            after: row,
            request: req,
          },
          tx
        );

        return row;
      });

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
