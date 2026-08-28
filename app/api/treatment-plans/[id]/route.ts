import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, patients, procedures, treatmentPlanItems, treatmentPlans } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadTreatmentPlan } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

const updateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  dentistId: z.string().min(1).max(255).optional(),
  notes: z.string().max(65_535).nullable().optional(),
  consentFileId: z.string().max(255).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(
  PERMISSIONS.TREATMENT_PLANS_VIEW,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const plan = await loadTreatmentPlan(ctx, id);

    const [items, [patient], [dentist]] = await Promise.all([
      db
        .select({
          id: treatmentPlanItems.id,
          procedureId: treatmentPlanItems.procedureId,
          procedureName: procedures.name,
          procedureCode: procedures.code,
          isPerTooth: procedures.isPerTooth,
          teeth: treatmentPlanItems.teeth,
          surfaces: treatmentPlanItems.surfaces,
          toothConditionId: treatmentPlanItems.toothConditionId,
          unitPrice: treatmentPlanItems.unitPrice,
          quantity: treatmentPlanItems.quantity,
          discountType: treatmentPlanItems.discountType,
          discountValue: treatmentPlanItems.discountValue,
          netAmount: treatmentPlanItems.netAmount,
          status: treatmentPlanItems.status,
          appointmentId: treatmentPlanItems.appointmentId,
          visitProcedureId: treatmentPlanItems.visitProcedureId,
          sortOrder: treatmentPlanItems.sortOrder,
          notes: treatmentPlanItems.notes,
        })
        .from(treatmentPlanItems)
        .leftJoin(procedures, eq(treatmentPlanItems.procedureId, procedures.id))
        .where(eq(treatmentPlanItems.treatmentPlanId, id))
        .orderBy(asc(treatmentPlanItems.sortOrder), asc(treatmentPlanItems.createdAt)),
      db
        .select({
          id: patients.id,
          mrn: patients.mrn,
          firstName: patients.firstName,
          lastName: patients.lastName,
          defaultDiscountPercent: patients.defaultDiscountPercent,
        })
        .from(patients)
        .where(eq(patients.id, plan.patientId))
        .limit(1),
      db
        .select({ id: adminUsers.id, name: adminUsers.name })
        .from(adminUsers)
        .where(eq(adminUsers.id, plan.dentistId))
        .limit(1),
    ]);

    return NextResponse.json({ plan, items, patient: patient ?? null, dentist: dentist ?? null });
  }
);

export const PUT = withAuth(
  PERMISSIONS.TREATMENT_PLANS_EDIT,
  async (req, ctx, { params }: Params) => {
    const { id } = await params;
    const before = await loadTreatmentPlan(ctx, id);

    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Title, dentist and notes stay editable at any status; only the PRICING
    // is locked after acceptance, and that lives on the items.
    const patch: Record<string, unknown> = { updatedAt: clinicNow() };
    for (const field of ['title', 'dentistId', 'notes', 'consentFileId'] as const) {
      if (parsed.data[field] !== undefined) patch[field] = parsed.data[field];
    }

    await db.update(treatmentPlans).set(patch).where(eq(treatmentPlans.id, id));
    const after = await loadTreatmentPlan(ctx, id);

    await writeAuditLog({
      actor: ctx,
      action: AUDIT_ACTION.UPDATE,
      entityType: AUDIT_ENTITY.TREATMENT_PLAN,
      entityId: id,
      patientId: before.patientId,
      branchId: before.branchId,
      before,
      after,
      request: req,
    });

    return NextResponse.json(after);
  }
);
