import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, adminRoles } from '@/lib/schema';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

// bcrypt cost is embedded per-hash, so raising it here leaves existing
// cost-10 hashes verifying normally.
const BCRYPT_COST = 12;

const createSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(255).nullable().optional(),
  roleId: z.string().min(1).max(255),
  branchId: z.string().max(255).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  staffType: z
    .enum(['owner', 'dentist', 'hygienist', 'assistant', 'receptionist', 'manager', 'other'])
    .default('other'),
  licenseNumber: z.string().max(50).nullable().optional(),
  signatureUrl: z.string().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
});

/** `admin_roles.permissions` is a text column holding JSON — never trust it to parse. */
function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const rows = await db
      .select({
        admin: adminUsers,
        role: {
          id: adminRoles.id,
          name: adminRoles.name,
          permissions: adminRoles.permissions,
        },
      })
      .from(adminUsers)
      .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id));

    // Never return password hashes.
    const result = rows.map(({ admin, role }) => ({
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        roleId: admin.roleId,
        branchId: admin.branchId,
        phone: admin.phone,
        staffType: admin.staffType,
        licenseNumber: admin.licenseNumber,
        signatureUrl: admin.signatureUrl,
        isActive: admin.isActive,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
      },
      role: role ? { ...role, permissions: parsePermissions(role.permissions) } : null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching admins:', error);
    return NextResponse.json({ error: 'Failed to fetch admins' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const data = parsed.data;

    const [roleData] = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, data.roleId))
      .limit(1);

    if (!roleData) {
      return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, data.email))
      .limit(1);

    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const now = new Date();
    const newAdmin = {
      id: uuidv4(),
      email: data.email,
      password: await bcrypt.hash(data.password, BCRYPT_COST),
      name: data.name ?? null,
      roleId: data.roleId,
      branchId: data.branchId ?? null,
      phone: data.phone ?? null,
      staffType: data.staffType,
      licenseNumber: data.licenseNumber ?? null,
      signatureUrl: data.signatureUrl ?? null,
      isActive: data.isActive,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(adminUsers).values(newAdmin);

    const { password: _password, ...safe } = newAdmin;
    return NextResponse.json(safe, { status: 201 });
  } catch (error) {
    console.error('Error creating admin:', error);
    return NextResponse.json({ error: 'Failed to create admin' }, { status: 500 });
  }
}
