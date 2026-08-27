import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { announcements, announcementRecipients, courses, batches } from '@/lib/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { createAnnouncementForRecipients } from '@/lib/announcements';

export async function GET() {
  try {
    const rows = await db
      .select({
        announcement: announcements,
        course: { id: courses.id, title: courses.title },
        batch: { id: batches.id, batchName: batches.batchName },
        recipientCount: sql<number>`(
          select count(*) from ${announcementRecipients}
          where ${announcementRecipients.announcementId} = ${announcements.id}
        )`,
      })
      .from(announcements)
      .leftJoin(courses, eq(announcements.courseId, courses.id))
      .leftJoin(batches, eq(announcements.batchId, batches.id))
      .orderBy(desc(announcements.createdAt));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching announcements:', error);
    return NextResponse.json({ error: 'Failed to fetch announcements' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, description, url, imageUrl, audience, courseId, batchId, recipientIds, sendEmail, status } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const { announcement, emailsSent } = await createAnnouncementForRecipients({
      title,
      description,
      url,
      imageUrl,
      audience,
      courseId,
      batchId,
      recipientIds: Array.isArray(recipientIds) ? recipientIds : [],
      sendEmail,
      status,
    });

    return NextResponse.json({ ...announcement, emailsSent }, { status: 201 });
  } catch (error) {
    console.error('Error creating announcement:', error);
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
  }
}
