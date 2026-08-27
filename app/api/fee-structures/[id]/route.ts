import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeStructures, feeComponents } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const structure = await db.query.feeStructures.findFirst({
      where: eq(feeStructures.id, id),
    });

    if (!structure) {
      return NextResponse.json({ error: 'Fee structure not found' }, { status: 404 });
    }

    const components = await db
      .select()
      .from(feeComponents)
      .where(eq(feeComponents.feeStructureId, id));

    return NextResponse.json({ ...structure, components });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get fee structure' }, { status: 500 });
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
    if (data.billingCycle !== undefined) updateData.billingCycle = data.billingCycle;
    if (data.baseAmount !== undefined) updateData.baseAmount = parseInt(data.baseAmount);
    if (data.dueDayOfMonth !== undefined)
      updateData.dueDayOfMonth = data.dueDayOfMonth ? parseInt(data.dueDayOfMonth) : null;
    if (data.isActive !== undefined) updateData.isActive = !!data.isActive;
    if (data.courseId !== undefined) updateData.courseId = data.courseId;

    await db.update(feeStructures).set(updateData).where(eq(feeStructures.id, id));

    const updated = await db.query.feeStructures.findFirst({ where: eq(feeStructures.id, id) });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update fee structure' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Remove the structure's components first, then the structure.
    await db.delete(feeComponents).where(eq(feeComponents.feeStructureId, id));
    await db.delete(feeStructures).where(eq(feeStructures.id, id));
    return NextResponse.json({ message: 'Fee structure deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete fee structure' }, { status: 500 });
  }
}
