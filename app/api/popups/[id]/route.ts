import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { popups } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const popup = await db.query.popups.findFirst({ where: eq(popups.id, id) });

    if (!popup) {
      return NextResponse.json({ error: 'Popup not found' }, { status: 404 });
    }

    return NextResponse.json(popup);
  } catch (error) {
    console.error('Error fetching popup:', error);
    return NextResponse.json({ error: 'Failed to get popup' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
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

    await db
      .update(popups)
      .set({
        title,
        images: imageList,
        isActive: isActive === undefined ? true : Boolean(isActive),
        updatedAt: new Date(),
      })
      .where(eq(popups.id, id));

    const updated = await db.query.popups.findFirst({ where: eq(popups.id, id) });
    if (!updated) {
      return NextResponse.json({ error: 'Popup not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating popup:', error);
    return NextResponse.json({ error: 'Failed to update popup' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(popups).where(eq(popups.id, id));
    return NextResponse.json({ message: 'Popup deleted successfully' });
  } catch (error) {
    console.error('Error deleting popup:', error);
    return NextResponse.json({ error: 'Failed to delete popup' }, { status: 500 });
  }
}
