import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminUsers, adminRoles } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [adminData] = await db
      .select({
        admin: adminUsers,
        role: {
          id: adminRoles.id,
          name: adminRoles.name,
          permissions: adminRoles.permissions
        }
      })
      .from(adminUsers)
      .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
      .where(eq(adminUsers.id, id))
      .limit(1);

    if (!adminData) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    // Don't return password
    const { password, ...adminWithoutPassword } = adminData.admin;

    return NextResponse.json({
      ...adminWithoutPassword,
      role: adminData.role
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get admin' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await req.json();
    
    // Hash password if provided
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 10);
    }

    // If roleId is being updated, get the role name
    if (data.roleId) {
      const [roleData] = await db
        .select()
        .from(adminRoles)
        .where(eq(adminRoles.id, data.roleId))
        .limit(1);

      if (roleData) {
        data.role = roleData.name;
      }
    }

    await db
      .update(adminUsers)
      .set(data)
      .where(eq(adminUsers.id, id));

    // Get updated admin with role information
    const [updatedAdminData] = await db
      .select({
        admin: adminUsers,
        role: {
          id: adminRoles.id,
          name: adminRoles.name,
          permissions: adminRoles.permissions
        }
      })
      .from(adminUsers)
      .leftJoin(adminRoles, eq(adminUsers.roleId, adminRoles.id))
      .where(eq(adminUsers.id, id))
      .limit(1);

    if (!updatedAdminData) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    // Don't return password
    const { password, ...adminWithoutPassword } = updatedAdminData.admin;

    return NextResponse.json({
      ...adminWithoutPassword,
      role: updatedAdminData.role
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update admin' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await db
      .delete(adminUsers)
      .where(eq(adminUsers.id, id));

    return NextResponse.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to delete admin' }, { status: 500 });
  }
} 