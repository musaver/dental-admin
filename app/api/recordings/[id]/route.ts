import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recordings, classes } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const recording = await db.query.recordings.findFirst({
      where: eq(recordings.id, id),
    });

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return NextResponse.json(recording);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get recording' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await req.json();

    const updateData: any = { ...data };

    // A recording belongs to a class; keep batchId aligned with the chosen class.
    if (updateData.classId) {
      const linkedClass = await db.query.classes.findFirst({
        where: eq(classes.id, updateData.classId),
      });
      if (linkedClass?.batchId) {
        updateData.batchId = linkedClass.batchId;
      }
    } else if (updateData.classId === '') {
      updateData.classId = null;
    }

    // Normalize datetime from the datetime-local input
    if (typeof updateData.recordingDateTime === 'string' && updateData.recordingDateTime) {
      const withSeconds = updateData.recordingDateTime.includes(':00')
        ? updateData.recordingDateTime
        : updateData.recordingDateTime + ':00';
      updateData.recordingDateTime = new Date(withSeconds);
    }

    delete updateData.id;
    updateData.updatedAt = new Date();

    await db.update(recordings).set(updateData).where(eq(recordings.id, id));

    // Sync the recording URL back to the linked class so students see it on "My Classes"
    if (updateData.classId && updateData.recordingUrl) {
      await db
        .update(classes)
        .set({ recordingUrl: updateData.recordingUrl, updatedAt: new Date() })
        .where(eq(classes.id, updateData.classId));
    }

    const updatedRecording = await db.query.recordings.findFirst({
      where: eq(recordings.id, id),
    });

    if (!updatedRecording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return NextResponse.json(updatedRecording);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update recording' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db
      .delete(recordings)
      .where(eq(recordings.id, id));

    return NextResponse.json({ message: 'Recording deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete recording' }, { status: 500 });
  }
}
