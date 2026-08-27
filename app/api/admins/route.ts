import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, adminRoles } from '@/lib/schema';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

export async function GET() {
  try {
    const admins = await db
      .select({
        admin: adminUsers,
        role: {
          id: adminRoles.id,
          name: adminRoles.name,
          permissions: adminRoles.permissions
        }
      })
      .from(adminUsers)
      .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id));

    // Remove passwords from response and format data
    const adminsWithoutPasswords = admins.map(({ admin, role }) => ({
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        roleId: admin.roleId,
        role: admin.role,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
      },
      role
    }));

    return NextResponse.json(adminsWithoutPasswords);
  } catch (error) {
    console.error('Error fetching admins:', error);
    return NextResponse.json({ error: 'Failed to fetch admins' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, roleId } = await req.json();
    
    // Get the role information
    const [roleData] = await db
      .select()
      .from(adminRoles)
      .where(eq(adminRoles.id, roleId))
      .limit(1);

    if (!roleData) {
      return NextResponse.json({ error: 'Invalid role ID' }, { status: 400 });
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newAdmin = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      name,
      roleId,
      role: roleData.name, // Set the role name
    };

    await db.insert(adminUsers).values(newAdmin);

    // Return admin without password
    const { password: _, ...adminWithoutPassword } = newAdmin;

    return NextResponse.json(adminWithoutPassword, { status: 201 });
  } catch (error) {
    console.error('Error creating admin:', error);
    return NextResponse.json({ error: 'Failed to create admin' }, { status: 500 });
  }
} 