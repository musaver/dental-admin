import { db } from '@/lib/db';
import { messageTemplates } from '@/lib/schema';
import { getClinicIdentity, renderButton, renderLayout } from '@/lib/email';
import { escapeHtml, nl2br } from '@/lib/html';
import { and, eq, isNull, or } from 'drizzle-orm';

/**
 * Message templates.
 *
 * The CODE below is the catalogue and the default copy; the message_templates
 * TABLE holds optional per-key (and per-branch) overrides so staff can reword
 * an email without a deploy. The code default is the safety net: a missing,
 * deactivated or broken override can degrade the wording but can never stop an
 * appointment reminder going out.
 */

export interface TemplateDefinition {
  key: string;
  name: string;
  description: string;
  /** What the editor may reference. Anything else renders as ''. */
  variables: readonly string[];
  subject: (vars: TemplateVars) => string;
  html: (vars: TemplateVars) => string;
}

export type TemplateVars = Record<string, string | number | null | undefined>;

const v = (vars: TemplateVars, key: string) => escapeHtml(vars[key] ?? '');

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    key: 'appointment_confirmation',
    name: 'Appointment confirmation',
    description: 'Sent when an appointment is booked.',
    variables: ['patientName', 'dateTime', 'dentistName', 'clinicName', 'clinicPhone'],
    subject: (vars) => `Your appointment on ${vars.dateTime ?? ''}`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>Your appointment is booked for <strong>${v(vars, 'dateTime')}</strong>
   with ${v(vars, 'dentistName')}.</p>
<p>If you need to change it, please call us on ${v(vars, 'clinicPhone')}.</p>`,
  },
  {
    key: 'appointment_reminder',
    name: 'Appointment reminder',
    description: 'Sent the day before an appointment.',
    variables: ['patientName', 'dateTime', 'dentistName', 'clinicName', 'clinicPhone'],
    subject: (vars) => `Reminder: your appointment on ${vars.dateTime ?? ''}`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>A reminder that you have an appointment on <strong>${v(vars, 'dateTime')}</strong>
   with ${v(vars, 'dentistName')}.</p>
<p>If you cannot make it, please call ${v(vars, 'clinicPhone')} so the time can be offered
   to someone else.</p>`,
  },
  {
    key: 'appointment_cancelled',
    name: 'Appointment cancelled',
    description: 'Confirms a cancellation.',
    variables: ['patientName', 'dateTime', 'clinicPhone'],
    subject: (vars) => `Your appointment on ${vars.dateTime ?? ''} has been cancelled`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>Your appointment on <strong>${v(vars, 'dateTime')}</strong> has been cancelled.</p>
<p>Call us on ${v(vars, 'clinicPhone')} whenever you would like to rebook.</p>`,
  },
  {
    key: 'recall_due',
    name: 'Recall reminder',
    description: 'Invites a patient back when a recall falls due.',
    variables: ['patientName', 'recallType', 'clinicName', 'clinicPhone'],
    subject: () => `Time for your next dental visit`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>It has been a while since your last ${v(vars, 'recallType')} visit, and you are due
   for a check-up.</p>
<p>Call ${v(vars, 'clinicPhone')} to book a time that suits you.</p>`,
  },
  {
    key: 'treatment_plan_proposed',
    name: 'Treatment plan proposed',
    description: 'Sent when a plan is put to the patient.',
    variables: ['patientName', 'planTitle', 'netAmount', 'dentistName', 'portalLink'],
    subject: (vars) => `Your treatment plan: ${vars.planTitle ?? ''}`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>${v(vars, 'dentistName')} has prepared a treatment plan for you:
   <strong>${v(vars, 'planTitle')}</strong>, totalling <strong>${v(vars, 'netAmount')}</strong>.</p>
${vars.portalLink ? renderButton('View and accept your plan', String(vars.portalLink)) : ''}
<p>Please contact the clinic if you have any questions about it.</p>`,
  },
  {
    key: 'payment_reminder',
    name: 'Payment reminder',
    description: 'Sent for an overdue balance.',
    variables: ['patientName', 'invoiceNumber', 'balance', 'clinicPhone'],
    subject: (vars) => `Outstanding balance on invoice ${vars.invoiceNumber ?? ''}`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>Invoice <strong>${v(vars, 'invoiceNumber')}</strong> has an outstanding balance of
   <strong>${v(vars, 'balance')}</strong>.</p>
<p>You can settle it at the clinic, or call ${v(vars, 'clinicPhone')} if anything about it
   looks wrong.</p>`,
  },
  {
    key: 'portal_invite',
    name: 'Portal invitation',
    description: 'Invites a patient to activate their portal account.',
    variables: ['patientName', 'activateLink', 'clinicName'],
    subject: (vars) => `Your ${vars.clinicName ?? 'clinic'} patient portal`,
    html: (vars) => `
<p>Dear ${v(vars, 'patientName')},</p>
<p>You can now see your appointments, treatment plans and invoices online.</p>
${renderButton('Activate your account', String(vars.activateLink ?? ''))}
<p>This link is personal to you and expires in 7 days.</p>`,
  },
  {
    key: 'portal_otp',
    name: 'Portal sign-in code',
    description: 'The one-time code for portal login.',
    variables: ['otp', 'clinicName'],
    subject: (vars) => `${vars.otp ?? ''} is your sign-in code`,
    html: (vars) => `
<p>Your sign-in code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;">${v(vars, 'otp')}</p>
<p>It expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
  },
  {
    key: 'staff_welcome',
    name: 'Staff welcome',
    description: 'Sent when a staff account is created.',
    variables: ['staffName', 'email', 'loginUrl', 'clinicName'],
    subject: (vars) => `Your ${vars.clinicName ?? 'clinic'} staff account`,
    html: (vars) => `
<p>Hello ${v(vars, 'staffName')},</p>
<p>An account has been created for you (${v(vars, 'email')}). Your administrator will give
   you your first password; please change it after signing in.</p>
${renderButton('Sign in', String(vars.loginUrl ?? ''))}`,
  },
] as const;

export type TemplateKey = (typeof TEMPLATES)[number]['key'];

const byKey = new Map(TEMPLATES.map((t) => [t.key, t]));

export function getTemplateDefinition(key: string): TemplateDefinition | null {
  return byKey.get(key) ?? null;
}

/** {{name}} substitution for the DB overrides. Every value is escaped. */
export function renderVars(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const value = vars[name];
    if (value === null || value === undefined) {
      // Never leave a literal {{x}} in a patient's inbox.
      console.warn(`Template variable {{${name}}} had no value.`);
      return '';
    }
    return escapeHtml(value);
  });
}

export interface RenderedMessage {
  subject: string;
  html: string;
  templateKey: string;
  /** True when a DB override supplied the copy. */
  overridden: boolean;
}

/**
 * Render a template: branch override first, then clinic-wide override, then
 * the code default. Broken overrides fall through rather than failing.
 */
export async function renderTemplate(
  key: string,
  vars: TemplateVars,
  options: { branchId?: string | null } = {}
): Promise<RenderedMessage> {
  const definition = getTemplateDefinition(key);
  if (!definition) throw new Error(`Unknown template: ${key}`);

  const identity = await getClinicIdentity();
  const fullVars: TemplateVars = {
    clinicName: identity.clinicName,
    clinicPhone: identity.phone ?? '',
    ...vars,
  };

  let subject: string | null = null;
  let body: string | null = null;
  let overridden = false;

  try {
    const overrides = await db
      .select()
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.templateKey, key),
          eq(messageTemplates.isActive, true),
          options.branchId
            ? or(eq(messageTemplates.branchId, options.branchId), isNull(messageTemplates.branchId))
            : isNull(messageTemplates.branchId)
        )
      );

    // A branch-specific override beats a clinic-wide one.
    const override =
      overrides.find((o) => o.branchId === options.branchId) ??
      overrides.find((o) => o.branchId === null);

    if (override?.subject && override?.bodyHtml) {
      subject = renderVars(override.subject, fullVars);
      body = renderVars(override.bodyHtml, fullVars);
      overridden = true;
    }
  } catch (error) {
    console.error(`Template override lookup failed for ${key}; using the default.`, error);
  }

  if (subject === null || body === null) {
    subject = definition.subject(fullVars);
    body = definition.html(fullVars);
    overridden = false;
  }

  return {
    subject,
    html: renderLayout(body, identity),
    templateKey: key,
    overridden,
  };
}

export { nl2br };
