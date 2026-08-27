import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeDiscounts } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const discount = await db.query.feeDiscounts.findFirst({ where: eq(feeDiscounts.id, id) });
    if (!discount) {
      return NextResponse.json({ error: 'Discount not found' }, { status: 404 });
    }
    return NextResponse.json(discount);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get discount' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await req.json();

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.scope !== undefined) {
      updateData.scope = data.scope;
      // Keep only the target field relevant to the scope.
      updateData.userId = data.scope === 'student' ? data.userId || null : null;
      updateData.courseId = data.scope === 'course' ? data.courseId || null : null;
      updateData.batchId = data.scope === 'batch' ? data.batchId || null : null;
    }
    if (data.discountType !== undefined) updateData.discountType = data.discountType;
    if (data.value !== undefined) updateData.value = parseInt(data.value);
    if (data.isActive !== undefined) updateData.isActive = !!data.isActive;
    if (data.validFrom !== undefined) updateData.validFrom = data.validFrom ? new Date(data.validFrom) : null;
    if (data.validTo !== undefined) updateData.validTo = data.validTo ? new Date(data.validTo) : null;

    await db.update(feeDiscounts).set(updateData).where(eq(feeDiscounts.id, id));
    const updated = await db.query.feeDiscounts.findFirst({ where: eq(feeDiscounts.id, id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update discount' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(feeDiscounts).where(eq(feeDiscounts.id, id));
    return NextResponse.json({ message: 'Discount deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete discount' }, { status: 500 });
  }
}
