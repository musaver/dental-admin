import { db } from '@/lib/db';
import { announcements, announcementRecipients, user } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, inArray } from 'drizzle-orm';
import { sendAnnouncementEmail } from '@/lib/email';
import { createNotifications } from '@/lib/notifications';

export interface CreateAnnouncementOptions {
  title: string;
  description?: string | null;
  url?: string | null; // stored on the announcement + used as the in-app notification link
  imageUrl?: string | null;
  audience?: string; // all | course | batch | custom
  courseId?: string | null;
  batchId?: string | null;
  recipientIds: string[];
  sendEmail?: boolean;
  status?: string; // draft | published
  emailUrl?: string | null; // absolute link for the email button (defaults to url)
  createdBy?: string | null;
}

// Send to recipients in chunks so one failure doesn't abort the batch.
async function emailRecipients(
  recipientIds: string[],
  payload: { title: string; description?: string | null; url?: string | null }
) {
  if (recipientIds.length === 0) return { sent: 0 };

  const recipients = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(inArray(user.id, recipientIds));

  const CHUNK = 20;
  let sent = 0;
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const chunk = recipients.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.filter((r) => r.email).map((r) => sendAnnouncementEmail(r.email as string, payload))
    );
    sent += results.filter((r) => r.status === 'fulfilled').length;
  }
  return { sent };
}

/**
 * Creates an announcement, its recipient rows, in-app notifications, and (optionally) emails.
 * Shared by the Announcements module and the Tasks "Send announcement" action.
 */
export async function createAnnouncementForRecipients(opts: CreateAnnouncementOptions) {
  const { title, description, url, imageUrl, audience, courseId, batchId, status } = opts;
  const ids: string[] = Array.isArray(opts.recipientIds) ? [...new Set(opts.recipientIds)] : [];
  const announcementId = uuidv4();
  const now = new Date();

  const newAnnouncement = {
    id: announcementId,
    title,
    description: description || null,
    url: url || null,
    imageUrl: imageUrl || null,
    audience: audience || 'all',
    courseId: courseId || null,
    batchId: batchId || null,
    status: status || 'published',
    emailSent: false,
    emailSentAt: null as Date | null,
    recipientCount: ids.length,
    createdBy: opts.createdBy || null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(announcements).values(newAnnouncement);

  if (ids.length > 0) {
    await db.insert(announcementRecipients).values(
      ids.map((userId) => ({
        id: uuidv4(),
        announcementId,
        userId,
        emailedAt: null as Date | null,
        readAt: null as Date | null,
      }))
    );

    // In-app notifications for every recipient (independent of the email toggle)
    try {
      await createNotifications(ids, {
        type: 'announcement',
        title,
        message: description || null,
        link: url || '/news',
        imageUrl: imageUrl || null,
        referenceId: announcementId,
      });
    } catch (notifyErr) {
      console.error('Failed to create announcement notifications:', notifyErr);
    }
  }

  let emailsSent = 0;
  if (opts.sendEmail && ids.length > 0) {
    const { sent } = await emailRecipients(ids, {
      title,
      description,
      url: opts.emailUrl ?? url,
    });
    emailsSent = sent;
    await db
      .update(announcements)
      .set({ emailSent: true, emailSentAt: new Date() })
      .where(eq(announcements.id, announcementId));
    await db
      .update(announcementRecipients)
      .set({ emailedAt: new Date() })
      .where(eq(announcementRecipients.announcementId, announcementId));
  }

  return { announcement: { ...newAnnouncement, emailSent: emailsSent > 0 }, emailsSent };
}
