import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recordings, batches, courses, classes } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const allRecordings = await db
      .select({
        recording: recordings,
        batch: {
          id: batches.id,
          batchName: batches.batchName
        },
        course: {
          id: courses.id,
          title: courses.title
        },
        class: {
          id: classes.id,
          title: classes.title
        }
      })
      .from(recordings)
      .leftJoin(batches, eq(recordings.batchId, batches.id))
      .leftJoin(courses, eq(batches.courseId, courses.id))
      .leftJoin(classes, eq(recordings.classId, classes.id));

    return NextResponse.json(allRecordings);
  } catch (error) {
    console.error('Error fetching recordings:', error);
    return NextResponse.json({ error: 'Failed to fetch recordings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { recordingTitle, batchId, classId, recordingDateTime, recordingUrl, showToAllUsers } = await request.json();

    // A recording now belongs to a class; derive the batch from it when needed.
    let resolvedBatchId = batchId;
    if (classId && !resolvedBatchId) {
      const linkedClass = await db.query.classes.findFirst({ where: eq(classes.id, classId) });
      resolvedBatchId = linkedClass?.batchId || null;
    }

    if (!resolvedBatchId) {
      return NextResponse.json({ error: 'A batch (or a class linked to a batch) is required' }, { status: 400 });
    }

    // Fix datetime handling - create proper Date object from local datetime input
    // datetime-local gives us "YYYY-MM-DDTHH:MM" format
    const dateTimeWithSeconds = recordingDateTime.includes(':00') ? recordingDateTime : recordingDateTime + ':00';
    const recordingDate = new Date(dateTimeWithSeconds);

    const newRecording = {
      id: uuidv4(),
      recordingTitle,
      batchId: resolvedBatchId,
      classId: classId || null,
      recordingDateTime: recordingDate,
      recordingUrl: recordingUrl || null,
      showToAllUsers: showToAllUsers !== undefined ? showToAllUsers : true,
    };

    await db.insert(recordings).values(newRecording);

    // Keep the linked class's recordingUrl in sync so it shows on the student "My Classes" view
    if (classId && recordingUrl) {
      await db
        .update(classes)
        .set({ recordingUrl, updatedAt: new Date() })
        .where(eq(classes.id, classId));
    }

    return NextResponse.json(newRecording, { status: 201 });
  } catch (error) {
    console.error('Error creating recording:', error);
    return NextResponse.json({ error: 'Failed to create recording' }, { status: 500 });
  }
}
