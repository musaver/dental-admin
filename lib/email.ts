import { db } from '@/lib/db';
import { clinicSettings } from '@/lib/schema';
import { escapeHtml } from '@/lib/html';

/**
 * Transactional email, via Brevo's REST API.
 *
 * `sib-api-v3-sdk` was a phantom dependency — declared in package.json with a
 * hand-written .d.ts, and imported by nothing. Removed; this plain fetch is
 * the whole integration.
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/** Cached so every email does not re-read the settings singleton. */
const SETTINGS_TTL_MS = 5 * 60_000;
let cachedSettings: { at: number; value: ClinicIdentity } | null = null;

export interface ClinicIdentity {
  clinicName: string;
  replyTo: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

export async function getClinicIdentity(): Promise<ClinicIdentity> {
  if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_TTL_MS) {
    return cachedSettings.value;
  }

  const [row] = await db.select().from(clinicSettings).limit(1);
  const value: ClinicIdentity = {
    clinicName: row?.clinicName ?? 'Dental Clinic',
    replyTo: row?.email ?? null,
    phone: row?.phone ?? null,
    address: row?.address ?? null,
    logoUrl: row?.logoUrl ?? null,
  };

  cachedSettings = { at: Date.now(), value };
  return value;
}

/** Drop the cache after a settings change so the next email reflects it. */
export function invalidateClinicIdentity() {
  cachedSettings = null;
}

export interface SendResult {
  messageId: string | null;
  /** True when nothing was actually sent — dry run, or no API key. */
  simulated: boolean;
}

export interface SendOptions {
  /** Brevo tags the message, giving per-template delivery stats for free. */
  tags?: string[];
  replyTo?: string | null;
}

/**
 * Send one HTML email.
 *
 * The from-address must sit on a Brevo-verified domain, so it comes from the
 * environment; the display name follows whatever the clinic has renamed itself
 * to in settings.
 *
 * With EMAIL_DRY_RUN set, or no BREVO_API_KEY configured, this logs and
 * returns instead of sending. A missing key must never 500 the endpoint that
 * happened to trigger an email — booking an appointment should not fail
 * because the mail provider is unconfigured.
 */
export async function sendHtmlEmail(
  to: string,
  subject: string,
  html: string,
  options: SendOptions = {}
): Promise<SendResult> {
  const identity = await getClinicIdentity();
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.BREVO_SENDER_EMAIL;

  if (process.env.EMAIL_DRY_RUN === '1' || !apiKey || !from) {
    if (!apiKey || !from) {
      console.warn(
        `Email not sent to ${to}: ${!apiKey ? 'BREVO_API_KEY' : 'BREVO_SENDER_EMAIL'} is not set. ` +
          `Subject: ${subject}`
      );
    } else {
      console.info(`[dry run] would email ${to}: ${subject}`);
    }
    return { messageId: null, simulated: true };
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: identity.clinicName, email: from },
      to: [{ email: to }],
      replyTo: options.replyTo ?? identity.replyTo ? { email: options.replyTo ?? identity.replyTo } : undefined,
      subject,
      htmlContent: html,
      tags: options.tags,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Brevo rejected the message (${res.status}).`);
  }

  const body = await res.json().catch(() => ({}));
  return { messageId: body?.messageId ?? null, simulated: false };
}

/**
 * Wraps template content in the clinic's letterhead.
 *
 * Inline styles throughout: email clients strip <style> blocks, and there is
 * no cascade to rely on.
 */
export function renderLayout(
  bodyHtml: string,
  identity: ClinicIdentity,
  options: { preheader?: string } = {}
): string {
  const logo = identity.logoUrl
    ? `<img src="${escapeHtml(identity.logoUrl)}" alt="${escapeHtml(identity.clinicName)}"
           style="max-height:48px;margin-bottom:12px;">`
    : '';

  const footerParts = [identity.address, identity.phone, identity.replyTo]
    .filter(Boolean)
    .map((part) => escapeHtml(part!));

  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#111827;">
  ${
    options.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>`
      : ''
  }
  <div style="padding:24px 0;border-bottom:1px solid #e5e7eb;">
    ${logo}
    <div style="font-size:18px;font-weight:600;">${escapeHtml(identity.clinicName)}</div>
  </div>
  <div style="padding:24px 0;font-size:15px;line-height:1.6;">
    ${bodyHtml}
  </div>
  <div style="padding:16px 0;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
    ${footerParts.join(' &middot; ')}
  </div>
</div>`.trim();
}

/** A primary call-to-action button, styled inline for email clients. */
export function renderButton(label: string, url: string): string {
  return `<p style="margin:24px 0;">
  <a href="${escapeHtml(url)}" target="_blank"
     style="background:#2563eb;color:#ffffff;text-decoration:none;padding:11px 22px;
            border-radius:6px;display:inline-block;font-weight:600;">
    ${escapeHtml(label)}
  </a>
</p>`;
}
