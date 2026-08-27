import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

/**
 * `user` is the PATIENT-PORTAL account table (NextAuth adapter shape), not a
 * staff table. Staff live in `admin_users` and are managed via /api/admins.
 *
 * There is no `password` column here — portal login is email OTP against
 * `user.otp` / `user.otp_expiry` (see Phase 7). There is no `role` column
 * either; portal accounts are linked to a clinical record via
 * `patients.portalUserId`.
 */
const createSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().max(255).nullable().optional(),
  firstName: z.string().max(100).nullable().optional(),
  lastName: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
});

export async function GET() {
  try {
    const allUsers = await db.select().from(user);
    return NextResponse.json(allUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const [existing] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, data.email))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const now = new Date();
    const newUser = {
      id: uuidv4(),
      email: data.email,
      name: data.name ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      phone: data.phone ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(user).values(newUser);

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
