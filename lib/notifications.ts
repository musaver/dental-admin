import { db } from '@/lib/db';
import { notifications, orders } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { and, eq } from 'drizzle-orm';

export interface NotificationPayload {
  type: 'announcement' | 'class' | 'course' | 'batch';
  title: string;
  message?: string | null;
  link?: string | null;
  imageUrl?: string | null;
  referenceId?: string | null;
}

// Bulk-insert one notification row per user. No-op on an empty list.
export async function createNotifications(userIds: string[], payload: NotificationPayload) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (ids.length === 0) return { created: 0 };

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
  }));

  await db.insert(notifications).values(rows);
  return { created: rows.length };
}

// Distinct users with a completed order for the given batch (same audience as My Classes).
export async function getBatchEnrolledUserIds(batchId: string): Promise<string[]> {
  if (!batchId) return [];
  const rows = await db
    .selectDistinct({ userId: orders.userId })
    .from(orders)
    .where(and(eq(orders.batchId, batchId), eq(orders.status, 'completed')));

  return [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
}
