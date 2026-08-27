import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { courses } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    const allCourses = await db.select().from(courses);
    return NextResponse.json(allCourses);
  } catch (error) {
    console.error('Error fetching courses:', error);
    return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, description, price, featured, image } = await request.json();
    
    const newCourse = {
      id: uuidv4(),
      title,
      description,
      price: Number(price),
      featured: Number(featured) || 0,
      image: image || null,
    };
    
    await db.insert(courses).values(newCourse);
    
    return NextResponse.json(newCourse, { status: 201 });
  } catch (error) {
    console.error('Error creating course:', error);
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 });
  }
} 