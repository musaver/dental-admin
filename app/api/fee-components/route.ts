import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeComponents } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
  try {
    const { feeStructureId, name, amount, frequency, isActive } = await request.json();

    if (!feeStructureId || !name || amount === undefined) {
      return NextResponse.json(
        { error: 'feeStructureId, name and amount are required' },
        { status: 400 }
      );
    }

    const newComponent = {
      id: uuidv4(),
      feeStructureId,
      name,
      amount: parseInt(amount),
      frequency: frequency || 'recurring',
      isActive: isActive === undefined ? true : !!isActive,
    };

    await db.insert(feeComponents).values(newComponent);

    return NextResponse.json(newComponent, { status: 201 });
  } catch (error) {
    console.error('Error creating fee component:', error);
    return NextResponse.json({ error: 'Failed to create fee component' }, { status: 500 });
  }
}
