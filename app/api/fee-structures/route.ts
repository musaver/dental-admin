import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeStructures, courses } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const all = await db
      .select({
        structure: feeStructures,
        course: { id: courses.id, title: courses.title, price: courses.price },
      })
      .from(feeStructures)
      .leftJoin(courses, eq(feeStructures.courseId, courses.id));

    return NextResponse.json(all);
  } catch (error) {
    console.error('Error fetching fee structures:', error);
    return NextResponse.json({ error: 'Failed to fetch fee structures' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { courseId, name, billingCycle, baseAmount, dueDayOfMonth, isActive } = await request.json();

    if (!courseId || !name) {
      return NextResponse.json({ error: 'courseId and name are required' }, { status: 400 });
    }

    // Default baseAmount to the course price when not supplied.
    let resolvedBase = baseAmount;
    if (resolvedBase === undefined || resolvedBase === null || resolvedBase === '') {
      const course = await db.query.courses.findFirst({ where: eq(courses.id, courseId) });
      resolvedBase = course?.price ?? 0;
    }

    const newStructure = {
      id: uuidv4(),
      courseId,
      name,
      billingCycle: billingCycle || 'monthly',
      baseAmount: parseInt(resolvedBase),
      dueDayOfMonth: dueDayOfMonth ? parseInt(dueDayOfMonth) : null,
      isActive: isActive === undefined ? true : !!isActive,
    };

    await db.insert(feeStructures).values(newStructure);

    return NextResponse.json(newStructure, { status: 201 });
  } catch (error) {
    console.error('Error creating fee structure:', error);
    return NextResponse.json({ error: 'Failed to create fee structure' }, { status: 500 });
  }
}
