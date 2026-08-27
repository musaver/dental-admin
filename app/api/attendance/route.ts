import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { attendance, batches, user } from '@/lib/schema';
import { eq, gte, lte, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const userId = searchParams.get('userId');
    const batchId = searchParams.get('batchId');

    let whereConditions = [];

    // Add date filtering if provided
    if (startDate) {
      whereConditions.push(gte(attendance.date, new Date(startDate)));
    }
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999); // Include the entire end date
      whereConditions.push(lte(attendance.date, endDateTime));
    }
    
    // Add user filtering if provided
    if (userId) {
      whereConditions.push(eq(attendance.userId, userId));
    }
    
    // Add batch filtering if provided
    if (batchId) {
      whereConditions.push(eq(attendance.batchId, batchId));
    }

    const attendanceRecords = await db
      .select({
        attendance: attendance,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        },
        batch: {
          id: batches.id,
          batchName: batches.batchName
        }
      })
      .from(attendance)
      .leftJoin(user, eq(attendance.userId, user.id))
      .leftJoin(batches, eq(attendance.batchId, batches.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(attendance.date), desc(attendance.time));

    return NextResponse.json(attendanceRecords);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json({ error: 'Failed to fetch attendance' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId, batchId } = await request.json();
    
    if (!userId || !batchId) {
      return NextResponse.json({ error: 'User ID and Batch ID are required' }, { status: 400 });
    }

    // Check if user already has attendance for this batch today
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const existingAttendance = await db
      .select()
      .from(attendance)
      .where(
        and(
          eq(attendance.userId, userId),
          eq(attendance.batchId, batchId),
          gte(attendance.date, startOfDay),
          lte(attendance.date, endOfDay)
        )
      )
      .limit(1);

    if (existingAttendance.length > 0) {
      return NextResponse.json({ message: 'Attendance already recorded for today' }, { status: 200 });
    }

    // Create new attendance record
    const newAttendance = {
      id: uuidv4(),
      userId,
      batchId,
      date: new Date(),
      time: new Date(),
    };

    await db.insert(attendance).values(newAttendance);

    return NextResponse.json({ message: 'Attendance recorded successfully' }, { status: 201 });
  } catch (error) {
    console.error('Error recording attendance:', error);
    return NextResponse.json({ error: 'Failed to record attendance' }, { status: 500 });
  }
} 