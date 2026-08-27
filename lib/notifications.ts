import { db } from '@/lib/db';
import { notifications } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-app notifications for STAFF.
 *
 * `notifications.userId` always references `admin_users.id`. The column has no
 * discriminator, so this module is the single writer and that invariant is
 * maintained here rather than by the schema.
 *
 * `notifications.type` doubles as the discriminator for `referenceId` — see the
 * map below. `link` stays authoritative for navigation; `referenceId` is for
 * dedup and cleanup.
 */
export type NotificationType =
  // → appointments.id
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'appointment_reminder'
  // → leads.id
  | 'lead_assigned'
  | 'lead_followup_due'
  | 'lead_converted'
  // → tasks.id
  | 'task_assigned'
  | 'task_comment'
  | 'task_due'
  // → recalls.id
  | 'recall_due'
  // → invoices.id
  | 'invoice_overdue'
  | 'payment_received'
  // → treatment_plans.id
  | 'treatment_plan_proposed'
  | 'treatment_plan_accepted'
  // → patients.id
  | 'patient_alert'
  // referenceId is null
  | 'system';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  message?: string | null;
  link?: string | null;
  imageUrl?: string | null;
  referenceId?: string | null;
}

/** Bulk-insert one notification row per staff user. No-op on an empty list. */
export async function createNotifications(
  adminUserIds: string[],
  payload: NotificationPayload
) {
  const ids = [...new Set((adminUserIds || []).filter(Boolean))];
  if (ids.length === 0) return { created: 0 };

  const now = new Date();
  const rows = ids.map((userId) => ({
    id: uuidv4(),
    userId,
    type: payload.type,
    title: payload.title,
    message: payload.message ?? null,
    link: payload.link ?? null,
    imageUrl: payload.imageUrl ?? null,
    referenceId: payload.referenceId ?? null,
    isRead: false,
    readAt: null as Date | null,
    createdAt: now,
  }));

  await db.insert(notifications).values(rows);
  return { created: rows.length };
}
