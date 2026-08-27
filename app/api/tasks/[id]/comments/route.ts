import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { taskComments } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, asc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const comments = await db
      .select()
      .from(taskComments)
      .where(eq(taskComments.taskId, id))
      .orderBy(asc(taskComments.createdAt));

    return NextResponse.json(comments);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

// Admin reply to a task's comment thread.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { comment } = await req.json();

    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 });
    }

    const session = await getServerSession(authOptions);
    const sUser = session?.user as any;

    const newComment = {
      id: uuidv4(),
      taskId: id,
      authorId: sUser?.id || 'admin',
      authorType: 'admin',
      authorName: sUser?.name || sUser?.email || 'Admin',
      comment: comment.trim(),
    };

    await db.insert(taskComments).values(newComment);

    return NextResponse.json(newComment, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }
}
