import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { batches } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, id),
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    return NextResponse.json(batch);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get batch' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { batchName, courseId, startDate, endDate, capacity, description, image } = await req.json();
    
    // Validate required fields
    if (!batchName || !courseId || !startDate || !endDate || !capacity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Transform data to match schema requirements
    const updateData = {
      batchName,
      courseId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      capacity: Number(capacity),
      description: description || null,
      image: image || null,
    };

    await db
      .update(batches)
      .set(updateData)
      .where(eq(batches.id, id));

    const updatedBatch = await db.query.batches.findFirst({
      where: eq(batches.id, id),
    });

    if (!updatedBatch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    return NextResponse.json(updatedBatch);
  } catch (error) {
    console.error('Error updating batch:', error);
    return NextResponse.json({ error: 'Failed to update batch' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await db
      .delete(batches)
      .where(eq(batches.id, id));

    return NextResponse.json({ message: 'Batch deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete batch' }, { status: 500 });
  }
} 