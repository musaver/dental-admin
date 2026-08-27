import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { popups } from '@/lib/schema';
import { desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    const rows = await db.select().from(popups).orderBy(desc(popups.createdAt));
    return NextResponse.json(rows);
  } catch (error) {
    console.error('Error fetching popups:', error);
    return NextResponse.json({ error: 'Failed to fetch popups' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, images, isActive } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const imageList: string[] = Array.isArray(images)
      ? images.filter((u) => typeof u === 'string' && u.trim() !== '')
      : [];

    if (imageList.length === 0) {
      return NextResponse.json({ error: 'At least one image is required' }, { status: 400 });
    }

    const id = uuidv4();
    await db.insert(popups).values({
      id,
      title,
      images: imageList,
      isActive: isActive === undefined ? true : Boolean(isActive),
    });

    const created = await db.query.popups.findFirst({
      where: (p, { eq }) => eq(p.id, id),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Error creating popup:', error);
    return NextResponse.json({ error: 'Failed to create popup' }, { status: 500 });
  }
}
