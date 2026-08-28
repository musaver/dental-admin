import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { leadActivities, leads, patients, tasks } from '@/lib/schema';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { loadLead } from '@/lib/loaders';
import { writeAuditLog } from '@/lib/audit';
import {
  AUDIT_ACTION,
  AUDIT_ENTITY,
  LEAD_ACTIVITY_TYPE,
  LEAD_STATUS,
  PATIENT_STATUS,
} from '@/lib/enums';
import {
  findDuplicatePatients,
  isDuplicateKeyError,
  nextMrn,
  normalizePhone,
} from '@/lib/patients';
import { clinicNow } from '@/lib/datetime';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const schema = z.object({
  /** Attach the lead to an existing patient instead of creating one. */
  linkExistingPatientId: z.string().max(255).nullable().optional(),
  /** Proceed despite duplicate candidates, once a human has reviewed them. */
  allowDuplicate: z.boolean().optional(),
  overrides: z
    .object({
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().max(100).nullable().optional(),
      email: z.string().max(255).nullable().optional(),
      dateOfBirth: z.coerce.date().nullable().optional(),
      gender: z.string().max(10).nullable().optional(),
    })
    .optional(),
});

type Params = { params: Promise<{ id: string }> };

const MRN_RETRIES = 5;

/** 'Ahmed Ali Khan' -> first 'Ahmed', last 'Ali Khan'. lastName is nullable. */
function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? full,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

/**
 * Turn an enquiry into a patient.
 *
 * The riskiest write in the system: `leads.convertedPatientId` and
 * `patients.leadId` point at each other with no foreign key, so half a
 * conversion is permanently wrong and completely invisible. Everything below
 * happens in ONE transaction, and the lead row is locked first so two
 * simultaneous clicks cannot both create a patient.
 */
export const POST = withAuth(PERMISSIONS.LEADS_EDIT, async (req, ctx, { params }: Params) => {
  const { id } = await params;
  const lead = await loadLead(ctx, id);

  if (!ctx.can(PERMISSIONS.PATIENTS_CREATE)) {
    return NextResponse.json(
      { error: 'You need permission to register patients to convert an enquiry.', code: 'FORBIDDEN' },
      { status: 403 }
    );
  }

  const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please correct the highlighted fields.', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Idempotent: a double submit returns the patient already created rather
  // than making a second one. This is the likeliest way the pair would drift.
  if (lead.convertedPatientId) {
    const [existing] = await db
      .select()
      .from(patients)
      .where(eq(patients.id, lead.convertedPatientId))
      .limit(1);
    if (existing) {
      return NextResponse.json({ patient: existing, alreadyConverted: true });
    }
    // The pointer survives but the patient does not — repair rather than
    // refuse, since a dangling id is exactly what has no FK to prevent it.
    console.warn(`Lead ${id} points at missing patient ${lead.convertedPatientId}; reconverting.`);
  }

  const phone = normalizePhone(lead.phone)!;
  const name = splitName(lead.name);
  const firstName = input.overrides?.firstName ?? name.firstName;
  const lastName = input.overrides?.lastName ?? name.lastName;

  // Advisory duplicate check before anything is written.
  if (!input.linkExistingPatientId && !input.allowDuplicate) {
    const duplicates = await findDuplicatePatients(
      { phone, firstName, lastName, dateOfBirth: input.overrides?.dateOfBirth },
      { branchIds: ctx.isHeadOffice ? null : [ctx.branchId!] }
    );
    if (duplicates.length) {
      return NextResponse.json(
        {
          error: 'This person may already be a patient.',
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
      const result = await db.transaction(async (tx) => {
        // Lock the lead so concurrent conversions serialise.
        const [locked] = await tx
          .select()
          .from(leads)
          .where(eq(leads.id, id))
          .for('update')
          .limit(1);

        if (!locked) throw new Error('Lead disappeared mid-conversion.');
        if (locked.convertedPatientId) {
          const [already] = await tx
            .select()
            .from(patients)
            .where(eq(patients.id, locked.convertedPatientId))
            .limit(1);
          if (already) return { patient: already, alreadyConverted: true };
        }

        let patient;

        if (input.linkExistingPatientId) {
          const [candidate] = await tx
            .select()
            .from(patients)
            .where(eq(patients.id, input.linkExistingPatientId))
            .limit(1);

          if (!candidate) throw new Error('That patient does not exist.');
          if (candidate.branchId !== lead.branchId) {
            throw new Error('That patient belongs to a different branch.');
          }

          await tx
            .update(patients)
            .set({ leadId: locked.id, updatedAt: now })
            .where(eq(patients.id, candidate.id));

          patient = { ...candidate, leadId: locked.id };
        } else {
          const mrn = await nextMrn(tx, lead.branchId);
          const row = {
            id: uuidv4(),
            mrn,
            branchId: lead.branchId,
            firstName,
            lastName,
            gender: input.overrides?.gender ?? null,
            dateOfBirth: input.overrides?.dateOfBirth ?? null,
            cnic: null,
            phone,
            altPhone: null,
            email: input.overrides?.email ?? lead.email,
            address: null,
            city: null,
            emergencyContactName: null,
            emergencyContactPhone: null,
            emergencyContactRelation: null,
            guardianName: null,
            bloodGroup: null,
            occupation: null,
            // Keeps the acquisition source on the clinical record.
            referredBy: `Enquiry via ${lead.source.replace(/_/g, ' ')}`,
            leadId: locked.id,
            defaultDiscountPercent: 0,
            medicalNotes: null,
            dentalNotes: lead.interestNote,
            hasAlerts: false,
            portalUserId: null,
            status: PATIENT_STATUS.ACTIVE,
            registeredBy: ctx.userId,
            createdAt: now,
            updatedAt: now,
          };
          await tx.insert(patients).values(row);
          patient = row;
        }

        // The other half of the pair. Both sides, one transaction.
        await tx
          .update(leads)
          .set({
            convertedPatientId: patient.id,
            convertedAt: now,
            status: LEAD_STATUS.CONVERTED,
            updatedAt: now,
          })
          .where(eq(leads.id, id));

        // activityType is NOT NULL with no default, so it must be explicit.
        await tx.insert(leadActivities).values({
          id: uuidv4(),
          leadId: id,
          activityType: LEAD_ACTIVITY_TYPE.NOTE,
          note: `Converted to patient ${patient.mrn}`,
          outcome: null,
          performedBy: ctx.userId,
          createdAt: now,
        });

        // Open follow-ups move with the person. tasks allows both columns, so
        // the task keeps its lead link as provenance.
        await tx
          .update(tasks)
          .set({ patientId: patient.id, updatedAt: now })
          .where(eq(tasks.leadId, id));

        return { patient, alreadyConverted: false };
      });

      // Audit AFTER commit, and never a network call inside the transaction —
      // holding a pooled connection across an HTTP round trip exhausts the
      // pool under load.
      if (!result.alreadyConverted) {
        await writeAuditLog({
          actor: ctx,
          action: AUDIT_ACTION.UPDATE,
          entityType: AUDIT_ENTITY.LEAD,
          entityId: id,
          patientId: result.patient.id,
          branchId: lead.branchId,
          before: { status: lead.status, convertedPatientId: null },
          after: { status: LEAD_STATUS.CONVERTED, convertedPatientId: result.patient.id },
          request: req,
        });
        await writeAuditLog({
          actor: ctx,
          action: AUDIT_ACTION.CREATE,
          entityType: AUDIT_ENTITY.PATIENT,
          entityId: result.patient.id,
          patientId: result.patient.id,
          branchId: lead.branchId,
          after: { mrn: result.patient.mrn, fromLead: id },
          request: req,
        });
      }

      return NextResponse.json(result, { status: result.alreadyConverted ? 200 : 201 });
    } catch (error) {
      if (isDuplicateKeyError(error) && attempt < MRN_RETRIES) continue;
      if (error instanceof Error && /does not exist|different branch|disappeared/.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  return NextResponse.json(
    { error: 'Could not allocate a medical record number. Please try again.' },
    { status: 409 }
  );
});
