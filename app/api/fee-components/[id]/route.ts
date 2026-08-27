import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeComponents } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(feeComponents).where(eq(feeComponents.id, id));
    return NextResponse.json({ message: 'Fee component deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete fee component' }, { status: 500 });
  }
}
