import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orders, user, courses, batches } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
export async function GET() {
  try {
    const allOrders = await db
      .select({
        order: orders,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        },
        course: {
          id: courses.id,
          title: courses.title
        },
        batch: {
          id: batches.id,
          batchName: batches.batchName
        }
      })
      .from(orders)
      .leftJoin(user, eq(orders.userId, user.id))
      .leftJoin(courses, eq(orders.courseId, courses.id))
      .leftJoin(batches, eq(orders.batchId, batches.id));
      
    return NextResponse.json(allOrders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId, courseId, batchId, status } = await request.json();
    
    const newOrder = {
      id: uuidv4(),
      userId,
      courseId,
      batchId: batchId || null,
      status: status || 'pending',
    };
    
    await db.insert(orders).values(newOrder);
    
    return NextResponse.json(newOrder, { status: 201 });
  } catch (error) {
    console.error('Error creating order:', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
} 