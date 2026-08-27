import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, taskComments, classes } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getBatchEnrolledUserIds } from '@/lib/notifications';
import { createAnnouncementForRecipients } from '@/lib/announcements';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json(task);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get task' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { title, description, classId, dueDate, status, priority, attachmentUrl, sendAnnouncement } =
      await req.json();

    const updateData: any = {
      title,
      description: description ?? null,
      classId,
      dueDate: dueDate ? new Date(dueDate.includes(':') ? dueDate : dueDate + 'T00:00') : null,
      status: status || 'open',
      priority: priority || 'normal',
      attachmentUrl: attachmentUrl || null,
      updatedAt: new Date(),
    };

    await db.update(tasks).set(updateData).where(eq(tasks.id, id));

    let announcementSent = false;
    if (sendAnnouncement && classId) {
      try {
        const linkedClass = await db.query.classes.findFirst({ where: eq(classes.id, classId) });
        if (linkedClass) {
          const recipientIds = await getBatchEnrolledUserIds(linkedClass.batchId);
          const webBase = process.env.WEB_BASE_URL || '';
          await createAnnouncementForRecipients({
            title: `Task update: ${title}`,
            description: description || `A task has been updated for your class "${linkedClass.title}".`,
            url: `/dashboard/tasks/${id}`,
            emailUrl: webBase ? `${webBase}/dashboard/tasks/${id}` : null,
            audience: 'batch',
            courseId: linkedClass.courseId,
            batchId: linkedClass.batchId,
            recipientIds,
            sendEmail: true,
            status: 'published',
          });
          announcementSent = true;
          await db.update(tasks).set({ announcementSent: true }).where(eq(tasks.id, id));
        }
      } catch (annErr) {
        console.error('Failed to send task announcement:', annErr);
      }
    }

    const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
    if (!updated) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json({ ...updated, announcementSent });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(taskComments).where(eq(taskComments.taskId, id));
    await db.delete(tasks).where(eq(tasks.id, id));
    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
