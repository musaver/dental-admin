import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

// Explicit allowlist — never spread the request body into `.set()`.
const updateSchema = z
  .object({
    email: z.string().email().max(255),
    name: z.string().max(255).nullable(),
    firstName: z.string().max(100).nullable(),
    lastName: z.string().max(100).nullable(),
    displayName: z.string().max(100).nullable(),
    phone: z.string().max(20).nullable(),
    address: z.string().max(100).nullable(),
    city: z.string().max(100).nullable(),
    state: z.string().max(100).nullable(),
    country: z.string().max(100).nullable(),
    profilePicture: z.string().max(255).nullable(),
  })
  .partial();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const foundUser = await db.query.user.findFirst({
      where: eq(user.id, id),
    });

    if (!foundUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(foundUser);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    await db
      .update(user)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(user.id, id));

    const updatedUser = await db.query.user.findFirst({
      where: eq(user.id, id),
    });

    if (!updatedUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await db
      .delete(user)
      .where(eq(user.id, id));

    return NextResponse.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
} 