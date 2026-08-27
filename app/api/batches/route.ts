import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { batches, courses } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const allBatches = await db
      .select({
        batch: batches,
        course: {
          id: courses.id,
          title: courses.title
        }
      })
      .from(batches)
      .leftJoin(courses, eq(batches.courseId, courses.id));
      
    return NextResponse.json(allBatches);
  } catch (error) {
    console.error('Error fetching batches:', error);
    return NextResponse.json({ error: 'Failed to fetch batches' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { batchName, courseId, startDate, endDate, capacity, description, image } = await req.json();
    
    // Validate required fields
    if (!batchName || !courseId || !startDate || !endDate || !capacity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const newBatch = {
      id: uuidv4(),
      batchName,
      courseId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      capacity: Number(capacity),
      description: description || null,
      image: image || null,
    };
    
    await db.insert(batches).values(newBatch);
    
    return NextResponse.json(newBatch, { status: 201 });
  } catch (error) {
    console.error('Error creating batch:', error);
    return NextResponse.json({ error: 'Failed to create batch' }, { status: 500 });
  }
} 