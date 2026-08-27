import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeDiscounts, user, courses, batches } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const all = await db
      .select({
        discount: feeDiscounts,
        user: { id: user.id, name: user.name, email: user.email },
        course: { id: courses.id, title: courses.title },
        batch: { id: batches.id, batchName: batches.batchName },
      })
      .from(feeDiscounts)
      .leftJoin(user, eq(feeDiscounts.userId, user.id))
      .leftJoin(courses, eq(feeDiscounts.courseId, courses.id))
      .leftJoin(batches, eq(feeDiscounts.batchId, batches.id));

    return NextResponse.json(all);
  } catch (error) {
    console.error('Error fetching discounts:', error);
    return NextResponse.json({ error: 'Failed to fetch discounts' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, scope, userId, courseId, batchId, discountType, value, isActive, validFrom, validTo } = body;

    if (!name || !scope || !discountType || value === undefined) {
      return NextResponse.json(
        { error: 'name, scope, discountType and value are required' },
        { status: 400 }
      );
    }

    const newDiscount = {
      id: uuidv4(),
      name,
      scope,
      userId: scope === 'student' ? userId || null : null,
      courseId: scope === 'course' ? courseId || null : null,
      batchId: scope === 'batch' ? batchId || null : null,
      discountType,
      value: parseInt(value),
      isActive: isActive === undefined ? true : !!isActive,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
    };

    await db.insert(feeDiscounts).values(newDiscount);

    return NextResponse.json(newDiscount, { status: 201 });
  } catch (error) {
    console.error('Error creating discount:', error);
    return NextResponse.json({ error: 'Failed to create discount' }, { status: 500 });
  }
}
