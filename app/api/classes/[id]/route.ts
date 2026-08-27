import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classes } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { parseZoomMeetingId } from '@/lib/zoom';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const classItem = await db.query.classes.findFirst({
      where: eq(classes.id, id),
    });

    if (!classItem) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    return NextResponse.json(classItem);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get class' }, { status: 500 });
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

    // Normalize the datetime coming from datetime-local input
    if (typeof updateData.scheduledAt === 'string' && updateData.scheduledAt) {
      const withSeconds = updateData.scheduledAt.includes(':00')
        ? updateData.scheduledAt
        : updateData.scheduledAt + ':00';
      updateData.scheduledAt = new Date(withSeconds);
    }

    if (updateData.durationMinutes !== undefined && updateData.durationMinutes !== null) {
      updateData.durationMinutes = Number(updateData.durationMinutes);
    }

    // Auto-resolve the Zoom meeting ID from the link when not explicitly provided
    if ('zoomLink' in updateData) {
      const explicit = (updateData.zoomMeetingId || '').trim();
      updateData.zoomMeetingId = explicit || parseZoomMeetingId(updateData.zoomLink || '') || null;
    }

    // Don't try to overwrite the primary key
    delete updateData.id;
    updateData.updatedAt = new Date();

    await db.update(classes).set(updateData).where(eq(classes.id, id));

    const updatedClass = await db.query.classes.findFirst({
      where: eq(classes.id, id),
    });

    if (!updatedClass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 });
    }

    return NextResponse.json(updatedClass);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update class' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.delete(classes).where(eq(classes.id, id));

    return NextResponse.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete class' }, { status: 500 });
  }
}
