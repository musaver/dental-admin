import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { announcements, announcementRecipients, user } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, inArray } from 'drizzle-orm';
import { sendAnnouncementEmail } from '@/lib/email';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const announcement = await db.query.announcements.findFirst({
      where: eq(announcements.id, id),
    });

    if (!announcement) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    const recipientRows = await db
      .select({ userId: announcementRecipients.userId })
      .from(announcementRecipients)
      .where(eq(announcementRecipients.announcementId, id));

    return NextResponse.json({
      ...announcement,
      recipientIds: recipientRows.map((r) => r.userId),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get announcement' }, { status: 500 });
  }
}

async function emailRecipients(
  recipientIds: string[],
  payload: { title: string; description?: string | null; url?: string | null }
) {
  if (recipientIds.length === 0) return { sent: 0 };
  const recipients = await db
    .select({ email: user.email })
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

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const {
      title,
      description,
      url,
      imageUrl,
      audience,
      courseId,
      batchId,
      recipientIds,
      sendEmail,
      status,
    } = body;

    const hasRecipients = Array.isArray(recipientIds);
    const ids: string[] = hasRecipients ? [...new Set(recipientIds)] : [];

    const updateData: any = {
      title,
      description: description ?? null,
      url: url || null,
      imageUrl: imageUrl || null,
      audience: audience || 'all',
      courseId: courseId || null,
      batchId: batchId || null,
      status: status || 'published',
      updatedAt: new Date(),
    };
    if (hasRecipients) updateData.recipientCount = ids.length;

    await db.update(announcements).set(updateData).where(eq(announcements.id, id));

    // Replace the recipient set when provided
    if (hasRecipients) {
      await db.delete(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
      if (ids.length > 0) {
        await db.insert(announcementRecipients).values(
          ids.map((userId) => ({
            id: uuidv4(),
            announcementId: id,
            userId,
            emailedAt: null as Date | null,
            readAt: null as Date | null,
          }))
        );
      }
    }

    if (sendEmail && ids.length > 0) {
      await emailRecipients(ids, { title, description, url });
      await db
        .update(announcements)
        .set({ emailSent: true, emailSentAt: new Date() })
        .where(eq(announcements.id, id));
      await db
        .update(announcementRecipients)
        .set({ emailedAt: new Date() })
        .where(eq(announcementRecipients.announcementId, id));
    }

    const updated = await db.query.announcements.findFirst({ where: eq(announcements.id, id) });
    if (!updated) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
    await db.delete(announcements).where(eq(announcements.id, id));
    return NextResponse.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 });
  }
}
