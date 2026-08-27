import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { attendance, user } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

// Attendance rows for a single class, joined with the student.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const { classId } = await params;

    const rows = await db
      .select({
        id: attendance.id,
        userId: attendance.userId,
        userName: user.name,
        userEmail: user.email,
        date: attendance.date,
        joinTime: attendance.joinTime,
        leaveTime: attendance.leaveTime,
        durationMinutes: attendance.durationMinutes,
        source: attendance.source,
        meetingUuid: attendance.meetingUuid,
      })
      .from(attendance)
      .leftJoin(user, eq(attendance.userId, user.id))
      .where(eq(attendance.classId, classId))
      .orderBy(desc(attendance.joinTime));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching class attendance:', error);
    return NextResponse.json({ error: 'Failed to fetch class attendance' }, { status: 500 });
  }
}
