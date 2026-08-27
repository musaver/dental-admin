import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, taskComments, classes, batches, courses } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, sql } from 'drizzle-orm';
import { getBatchEnrolledUserIds } from '@/lib/notifications';
import { createAnnouncementForRecipients } from '@/lib/announcements';

export async function GET() {
  try {
    const rows = await db
      .select({
        task: tasks,
        class: { id: classes.id, title: classes.title, batchId: classes.batchId, courseId: classes.courseId },
        course: { id: courses.id, title: courses.title },
        batch: { id: batches.id, batchName: batches.batchName },
        commentCount: sql<number>`(
          select count(*) from ${taskComments}
          where ${taskComments.taskId} = ${tasks.id}
        )`,
      })
      .from(tasks)
      .leftJoin(classes, eq(tasks.classId, classes.id))
      .leftJoin(courses, eq(classes.courseId, courses.id))
      .leftJoin(batches, eq(classes.batchId, batches.id))
      .orderBy(desc(tasks.createdAt));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, description, classId, dueDate, status, priority, attachmentUrl, sendAnnouncement } =
      await request.json();

    if (!title || !classId) {
      return NextResponse.json({ error: 'Title and class are required' }, { status: 400 });
    }

    const linkedClass = await db.query.classes.findFirst({ where: eq(classes.id, classId) });
    if (!linkedClass) {
      return NextResponse.json({ error: 'Linked class not found' }, { status: 400 });
    }

    const taskId = uuidv4();
    const newTask = {
      id: taskId,
      title,
      description: description || null,
      classId,
      dueDate: dueDate ? new Date(dueDate.includes(':') ? dueDate : dueDate + 'T00:00') : null,
      status: status || 'open',
      priority: priority || 'normal',
      attachmentUrl: attachmentUrl || null,
      announcementSent: false,
    };

    await db.insert(tasks).values(newTask);

    let announcementSent = false;
    if (sendAnnouncement) {
      try {
        const recipientIds = await getBatchEnrolledUserIds(linkedClass.batchId);
        const webBase = process.env.WEB_BASE_URL || '';
        await createAnnouncementForRecipients({
          title: `New task: ${title}`,
          description: description || `A new task has been added for your class "${linkedClass.title}".`,
          url: `/dashboard/tasks/${taskId}`,
          emailUrl: webBase ? `${webBase}/dashboard/tasks/${taskId}` : null,
          audience: 'batch',
          courseId: linkedClass.courseId,
          batchId: linkedClass.batchId,
          recipientIds,
          sendEmail: true,
          status: 'published',
        });
        announcementSent = true;
        await db.update(tasks).set({ announcementSent: true }).where(eq(tasks.id, taskId));
      } catch (annErr) {
        console.error('Failed to send task announcement:', annErr);
      }
    }

    return NextResponse.json({ ...newTask, announcementSent }, { status: 201 });
  } catch (error) {
    console.error('Error creating task:', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}
