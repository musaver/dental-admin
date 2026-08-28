import { db } from '@/lib/db';
import { auditLogs } from '@/lib/schema';
import { clinicNow } from '@/lib/datetime';
import type { AuditAction, AuditEntity } from '@/lib/enums';
import type { StaffContext } from '@/lib/rbac';
import { v4 as uuidv4 } from 'uuid';

/**
 * The medico-legal record of who did what.
 *
 * `audit_logs.before` and `.after` are real json columns, so this stores an
 * actual diff rather than a description. The dedicated `patientId` column is
 * what makes "who opened this patient's chart" a single indexed query instead
 * of a scan across a polymorphic entityId.
 *
 * Audit rows are NEVER purged. They are the record.
 */

/** Values that must never reach the audit table. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'otp',
  'otpExpiry',
  'otp_expiry',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'access_token',
  'refresh_token',
  'id_token',
  'sessionToken',
  'apiKey',
  'secret',
]);

/** A single long clinical note would otherwise be written into the log twice. */
const MAX_STRING_LENGTH = 500;
/** Backstop on the whole payload, in case a row is unexpectedly wide. */
const MAX_PAYLOAD_BYTES = 8_000;

type Row = Record<string, unknown>;

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [${value.length} chars]`
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeValue);
  if (typeof value === 'object') return sanitizeRow(value as Row);
  return String(value);
}

function sanitizeRow(row: Row | null | undefined): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : sanitizeValue(value);
  }
  return out;
}

function capPayload(row: Row | null): Row | null {
  if (!row) return null;
  const json = JSON.stringify(row);
  if (json.length <= MAX_PAYLOAD_BYTES) return row;
  return { _truncated: true, _originalBytes: json.length, ...pickFirst(row, 20) };
}

function pickFirst(row: Row, n: number): Row {
  return Object.fromEntries(Object.entries(row).slice(0, n));
}

/**
 * Shallow diff of the fields that actually changed.
 * Storing whole rows on every update makes the table unreadable and enormous.
 */
export function diffRows(
  before: Row | null | undefined,
  after: Row | null | undefined
): { before: Row | null; after: Row | null } {
  if (!before || !after) {
    return { before: sanitizeRow(before), after: sanitizeRow(after) };
  }

  const changedBefore: Row = {};
  const changedAfter: Row = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[key];
    const a = after[key];
    const bNorm = b instanceof Date ? b.getTime() : b;
    const aNorm = a instanceof Date ? a.getTime() : a;
    if (bNorm === aNorm) continue;
    // updatedAt changes on every write; recording it is pure noise.
    if (key === 'updatedAt') continue;
    changedBefore[key] = b;
    changedAfter[key] = a;
  }

  if (!Object.keys(changedAfter).length) {
    return { before: null, after: null };
  }
  return { before: sanitizeRow(changedBefore), after: sanitizeRow(changedAfter) };
}

export interface AuditPayload {
  actor: Pick<StaffContext, 'userId' | 'email'> | { userId: string; email: string };
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string | null;
  /** Set on EVERY patient-scoped entry — it is the indexed access-log column. */
  patientId?: string | null;
  branchId?: string | null;
  before?: Row | null;
  after?: Row | null;
  request?: Request | null;
}

function requestMeta(req: Request | null | undefined) {
  if (!req) return { ipAddress: null, userAgent: null };
  const forwarded = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  return {
    ipAddress: forwarded ? forwarded.split(',')[0]!.trim().slice(0, 45) : null,
    // varchar(255): a long UA string would otherwise fail the insert and take
    // the surrounding clinical write down with it.
    userAgent: req.headers.get('user-agent')?.slice(0, 255) ?? null,
  };
}

/**
 * Write an audit entry.
 *
 * Pass `tx` to join a surrounding transaction — a rollback must take the audit
 * row with it, or the log ends up describing changes that never happened.
 *
 * Never throws: a failed audit write is logged to the console but must not
 * fail the clinical operation it was recording.
 */
export async function writeAuditLog(
  payload: AuditPayload,
  tx?: Pick<typeof db, 'insert'>
): Promise<void> {
  try {
    const executor = tx ?? db;
    const { ipAddress, userAgent } = requestMeta(payload.request);

    const isUpdate = payload.action === 'update';
    const { before, after } = isUpdate
      ? diffRows(payload.before, payload.after)
      : { before: sanitizeRow(payload.before), after: sanitizeRow(payload.after) };

    await executor.insert(auditLogs).values({
      id: uuidv4(),
      actorId: payload.actor.userId,
      actorEmail: payload.actor.email?.slice(0, 255) ?? null,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId ?? null,
      patientId: payload.patientId ?? null,
      branchId: payload.branchId ?? null,
      before: capPayload(before),
      after: capPayload(after),
      ipAddress,
      userAgent,
      createdAt: clinicNow(),
    });
  } catch (error) {
    console.error('Failed to write audit log:', error, {
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
    });
  }
}

/**
 * Record that someone LOOKED at something.
 *
 * Reserved for the handful of reads that matter medico-legally: opening a
 * patient chart, downloading a file, viewing a prescription, opening the audit
 * log, and every export. Deliberately not per-list-row, which would multiply
 * the table for no evidential value.
 */
export function auditView(
  actor: AuditPayload['actor'],
  entityType: AuditEntity,
  entityId: string,
  options: { patientId?: string | null; branchId?: string | null; request?: Request | null } = {}
) {
  return writeAuditLog({
    actor,
    action: 'view',
    entityType,
    entityId,
    patientId: options.patientId ?? null,
    branchId: options.branchId ?? null,
    request: options.request ?? null,
  });
}
