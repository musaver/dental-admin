import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { patients } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadPatient } from '@/lib/loaders';
import { auditView, writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY, PATIENT_STATUS } from '@/lib/enums';
import { normalizePhone } from '@/lib/patients';
import { patientUpdateSchema, validationError } from '@/lib/validation/patient';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(
  PERMISSIONS.PATIENTS_VIEW,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const patient = await loadPatient(ctx, id);

    // Opening a chart is a recorded event. This is one of the few reads worth
    // auditing — it answers "who looked at this patient's record".
    await auditView(ctx, AUDIT_ENTITY.PATIENT, patient.id, {
      patientId: patient.id,
      branchId: patient.branchId,
      request: req,
    });

    return NextResponse.json(patient);
  }
);

export const PUT = withAuth(
  PERMISSIONS.PATIENTS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const before = await loadPatient(ctx, id);

    const parsed = patientUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(validationError(parsed.error), { status: 400 });
    }
    const input = parsed.data;

    // Build from the allowlist only — never spread the request body.
    const patch: Record<string, unknown> = { updatedAt: clinicNow() };
    const FIELDS = [
      'firstName', 'lastName', 'gender', 'dateOfBirth', 'cnic', 'email',
      'address', 'city', 'emergencyContactName', 'emergencyContactRelation',
      'guardianName', 'bloodGroup', 'occupation', 'referredBy',
      'defaultDiscountPercent', 'medicalNotes', 'dentalNotes', 'status',
    ] as const;

    for (const field of FIELDS) {
      if (input[field] !== undefined) patch[field] = input[field];
    }

    // Phone numbers are normalised on the way in so duplicate detection keeps
    // working after an edit.
    for (const field of ['phone', 'altPhone', 'emergencyContactPhone'] as const) {
      if (input[field] !== undefined) patch[field] = normalizePhone(input[field]);
    }

    await db.update(patients).set(patch).where(eq(patients.id, id));
    const after = await loadPatient(ctx, id);

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.PATIENT,
      entityId: id,
      patientId: id,
      branchId: after.branchId,
      before,
      after,
      request: req,
    });

    return NextResponse.json(after);
  }
);

/**
 * Archive, never delete.
 *
 * Visits, invoices, prescriptions and audit rows all reference patients.id
 * with no foreign keys, so a hard delete would silently orphan a person's
 * entire clinical and financial history. `patients_delete` means archive.
 */
export const DELETE = withAuth(
  PERMISSIONS.PATIENTS_DELETE,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const before = await loadPatient(ctx, id);

    if (before.status === PATIENT_STATUS.ARCHIVED) {
      return NextResponse.json({ error: 'This patient is already archived.' }, { status: 409 });
    }

    await db
      .update(patients)
      .set({ status: PATIENT_STATUS.ARCHIVED, updatedAt: clinicNow() })
      .where(eq(patients.id, id));

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.PATIENT,
      entityId: id,
      patientId: id,
      branchId: before.branchId,
      before: { status: before.status },
      after: { status: PATIENT_STATUS.ARCHIVED },
      request: req,
    });

    return NextResponse.json({
      message: 'Patient archived. Their clinical history is retained.',
    });
  }
);
