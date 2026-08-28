import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless, signed portal invitations.
 *
 * A staff member invites a patient; the patient clicks the link, signs in with
 * an OTP for THAT SAME EMAIL, and activation links the two records. HMAC over
 * the payload with NEXTAUTH_SECRET means no invite table, no cleanup job, and
 * nothing to leak.
 *
 * Linking is NEVER automatic on email match: families share inboxes, and one
 * mistyped patients.email would hand someone else's clinical history to the
 * wrong person with no undo.
 */

const INVITE_TTL_DAYS = 7;

interface InvitePayload {
  patientId: string;
  email: string;
  exp: number;
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error('NEXTAUTH_SECRET is not set.');
  return value;
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createInviteToken(patientId: string, email: string, now = new Date()): string {
  const payload: InvitePayload = {
    patientId,
    email: email.toLowerCase(),
    exp: now.getTime() + INVITE_TTL_DAYS * 86_400_000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export type InviteResult =
  | { ok: true; patientId: string; email: string }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' };

export function verifyInviteToken(token: string, now = new Date()): InviteResult {
  const [body, signature] = token.split('.');
  if (!body || !signature) return { ok: false, reason: 'malformed' };

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let payload: InvitePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload.exp || payload.exp < now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, patientId: payload.patientId, email: payload.email };
}
