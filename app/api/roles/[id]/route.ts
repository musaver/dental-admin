import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoles } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const role = await db.select().from(adminRoles).where(eq(adminRoles.id, id));
    
    if (role.length === 0) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    
    return NextResponse.json(role[0]);
  } catch (error) {
    console.error('Error fetching role:', error);
    return NextResponse.json({ error: 'Failed to fetch role' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { name, permissions } = await req.json();
    
    await db.update(adminRoles)
      .set({
        name,
        permissions: typeof permissions === 'string' ? permissions : JSON.stringify(permissions),
      })
      .where(eq(adminRoles.id, id));
    
    const updatedRole = await db.select().from(adminRoles).where(eq(adminRoles.id, id));
    
    if (updatedRole.length === 0) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }
    
    return NextResponse.json(updatedRole[0]);
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await db.delete(adminRoles).where(eq(adminRoles.id, id));
    return NextResponse.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting role:', error);
    return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 });
  }
} 