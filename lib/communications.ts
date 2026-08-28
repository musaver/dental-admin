import { db } from '@/lib/db';
import { communicationLogs } from '@/lib/schema';
import { sendHtmlEmail } from '@/lib/email';
import { renderTemplate, type TemplateVars } from '@/lib/comm-templates';
import {
  COMM_CHANNEL,
  COMM_DIRECTION,
  COMM_STATUS,
  type CommChannel,
  type CommReferenceType,
} from '@/lib/enums';
import { clinicNow } from '@/lib/datetime';
import { desc, eq, or, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

/**
 * The communication record.
 *
 * Every message the clinic sends or receives — email, a phone call the desk
 * made, a WhatsApp someone logged by hand — lands in communication_logs, and
 * the patient profile renders that history.
 *
 * ONLY email actually sends in this phase. SMS and WhatsApp exist as channels
 * so staff can LOG them; nothing dispatches them automatically, and anything
 * that claims otherwise to the clinic is overpromising. Adding a provider
 * later means implementing one function, not a refactor.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface LogCommunicationInput {
  /** Exactly ONE of these two — the schema is polymorphic but unenforced. */
  patientId?: string | null;
  leadId?: string | null;
  channel: CommChannel;
  direction?: 'inbound' | 'outbound';
  subject?: string | null;
  body?: string | null;
  status?: string;
  templateKey?: string | null;
  providerMessageId?: string | null;
  referenceType?: CommReferenceType | null;
  referenceId?: string | null;
  performedBy?: string | null;
}

/**
 * Write one communication row.
 *
 * Enforces the patientId-XOR-leadId invariant the schema cannot: a row tied to
 * both (or neither) can never be shown on the right profile, and nothing at
 * the storage layer would ever complain.
 */
export async function logCommunication(
  input: LogCommunicationInput,
  tx: Executor = db
): Promise<string> {
  const hasPatient = Boolean(input.patientId);
  const hasLead = Boolean(input.leadId);

  if (hasPatient === hasLead) {
    throw new Error(
      'A communication belongs to exactly one of a patient or a lead — ' +
        `got ${hasPatient ? 'both' : 'neither'}.`
    );
  }

  const id = uuidv4();
  await tx.insert(communicationLogs).values({
    id,
    patientId: input.patientId ?? null,
    leadId: input.leadId ?? null,
    channel: input.channel,
    direction: input.direction ?? COMM_DIRECTION.OUTBOUND,
    subject: input.subject?.slice(0, 255) ?? null,
    body: input.body ?? null,
    status: input.status ?? COMM_STATUS.LOGGED,
    templateKey: input.templateKey ?? null,
    providerMessageId: input.providerMessageId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    performedBy: input.performedBy ?? null,
    createdAt: clinicNow(),
  });

  return id;
}

export interface SendTemplateInput {
  to: string | null | undefined;
  templateKey: string;
  vars: TemplateVars;
  patientId?: string | null;
  leadId?: string | null;
  branchId?: string | null;
  referenceType?: CommReferenceType | null;
  referenceId?: string | null;
  performedBy?: string | null;
}

export interface SendOutcome {
  status: 'sent' | 'failed' | 'skipped';
  communicationId: string;
  simulated?: boolean;
}

/**
 * Render, send, and log — the one path every automated email takes.
 *
 * NO ADDRESS IS NOT AN ERROR. patients.email is nullable and plenty of
 * patients are phone-only, so a missing address logs a 'skipped' row instead
 * of throwing. That row is the point: the front desk's "call these people"
 * list is exactly the skipped reminders.
 *
 * A provider failure logs 'failed' with the error in the body, and does NOT
 * throw — the caller decides whether a reminder failing should abort whatever
 * else it was doing (it almost never should).
 */
export async function sendTemplatedEmail(input: SendTemplateInput): Promise<SendOutcome> {
  const base = {
    patientId: input.patientId ?? null,
    leadId: input.leadId ?? null,
    channel: COMM_CHANNEL.EMAIL,
    templateKey: input.templateKey,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    performedBy: input.performedBy ?? null,
  } as const;

  if (!input.to) {
    const communicationId = await logCommunication({
      ...base,
      subject: `(no email address) ${input.templateKey}`,
      status: COMM_STATUS.SKIPPED,
    });
    return { status: 'skipped', communicationId };
  }

  const rendered = await renderTemplate(input.templateKey, input.vars, {
    branchId: input.branchId,
  });

  try {
    const result = await sendHtmlEmail(input.to, rendered.subject, rendered.html, {
      tags: [input.templateKey],
    });

    const communicationId = await logCommunication({
      ...base,
      subject: rendered.subject,
      body: rendered.html,
      status: COMM_STATUS.SENT,
      providerMessageId: result.messageId,
    });

    return { status: 'sent', communicationId, simulated: result.simulated };
  } catch (error) {
    const communicationId = await logCommunication({
      ...base,
      subject: rendered.subject,
      body: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
      status: COMM_STATUS.FAILED,
    });
    return { status: 'failed', communicationId };
  }
}

/**
 * A patient's communication history, INCLUDING what was sent while they were
 * still an enquiry.
 *
 * Pre-conversion rows are leadId-only forever — the XOR invariant is never
 * rewritten — so the join goes through patients.leadId, which is exactly the
 * provenance column the conversion wrote for this purpose.
 */
export async function getPatientCommunications(patientId: string, leadId: string | null) {
  return db
    .select()
    .from(communicationLogs)
    .where(
      leadId
        ? or(eq(communicationLogs.patientId, patientId), eq(communicationLogs.leadId, leadId))
        : eq(communicationLogs.patientId, patientId)
    )
    .orderBy(desc(communicationLogs.createdAt))
    .limit(200);
}

/** Everything sent about one entity — "which reminders went out for this appointment?" */
export async function getReferenceCommunications(
  referenceType: CommReferenceType,
  referenceId: string
) {
  return db
    .select()
    .from(communicationLogs)
    .where(
      and(
        eq(communicationLogs.referenceType, referenceType),
        eq(communicationLogs.referenceId, referenceId)
      )
    )
    .orderBy(desc(communicationLogs.createdAt));
}
