import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminRoles } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    const roles = await db.select().from(adminRoles);
    return NextResponse.json(roles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    return NextResponse.json({ error: 'Failed to fetch roles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, permissions } = await req.json();
    
    const newRole = {
      id: uuidv4(),
      name,
      permissions: typeof permissions === 'string' ? permissions : JSON.stringify(permissions),
    };
    
    await db.insert(adminRoles).values(newRole);
    
    return NextResponse.json(newRole, { status: 201 });
  } catch (error) {
    console.error('Error creating role:', error);
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
  }
} 