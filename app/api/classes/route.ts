import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classes, batches, courses } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';
import { createNotifications, getBatchEnrolledUserIds } from '@/lib/notifications';
import { parseZoomMeetingId } from '@/lib/zoom';

export async function GET() {
  try {
    const allClasses = await db
      .select({
        class: classes,
        batch: {
          id: batches.id,
          batchName: batches.batchName,
        },
        course: {
          id: courses.id,
          title: courses.title,
        },
      })
      .from(classes)
      .leftJoin(batches, eq(classes.batchId, batches.id))
      .leftJoin(courses, eq(classes.courseId, courses.id))
      .orderBy(desc(classes.scheduledAt));

    return NextResponse.json(allClasses);
  } catch (error) {
    console.error('Error fetching classes:', error);
    return NextResponse.json({ error: 'Failed to fetch classes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const {
      title,
      courseId,
      batchId,
      description,
      scheduledAt,
      durationMinutes,
      zoomLink,
      zoomMeetingId,
      zoomPasscode,
      recordingUrl,
      status,
      showToAllUsers,
    } = await request.json();

    if (!title || !courseId || !batchId || !scheduledAt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // datetime-local gives "YYYY-MM-DDTHH:MM" — append seconds so it parses as local time
    const dateTimeWithSeconds = scheduledAt.includes(':00') ? scheduledAt : scheduledAt + ':00';
    const scheduledDate = new Date(dateTimeWithSeconds);

    const newClass = {
      id: uuidv4(),
      title,
      courseId,
      batchId,
      description: description || null,
      scheduledAt: scheduledDate,
      durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
      zoomLink: zoomLink || null,
      zoomMeetingId: (zoomMeetingId && zoomMeetingId.trim()) || parseZoomMeetingId(zoomLink || '') || null,
      zoomPasscode: zoomPasscode || null,
      recordingUrl: recordingUrl || null,
      status: status || 'scheduled',
      showToAllUsers: showToAllUsers !== undefined ? showToAllUsers : true,
    };

    await db.insert(classes).values(newClass);

    // Notify enrolled students of this batch (when the class is visible to them)
    if (newClass.showToAllUsers) {
      try {
        const userIds = await getBatchEnrolledUserIds(batchId);
        const when = scheduledDate.toLocaleString();
        await createNotifications(userIds, {
          type: 'class',
          title: `New class: ${title}`,
          message: `A new class has been scheduled for ${when}.${description ? ` ${description}` : ''}`,
          link: '/dashboard/my-classes',
          referenceId: newClass.id,
        });
      } catch (notifyErr) {
        console.error('Failed to create class notifications:', notifyErr);
      }
    }

    return NextResponse.json(newClass, { status: 201 });
  } catch (error) {
    console.error('Error creating class:', error);
    return NextResponse.json({ error: 'Failed to create class' }, { status: 500 });
  }
}
