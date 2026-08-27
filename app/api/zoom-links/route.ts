import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { zoomLinks, batches } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Extracts the numeric meeting id from a Zoom join URL (/j/, /s/, /w/{id}).
function parseZoomMeetingId(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/(?:j|s|w)\/(\d+)/);
  return match ? match[1] : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    
    if (batchId) {
      // Get zoom link for specific batch
      const zoomLink = await db
        .select({
          zoomLink: zoomLinks,
          batch: {
            id: batches.id,
            batchName: batches.batchName
          }
        })
        .from(zoomLinks)
        .leftJoin(batches, eq(zoomLinks.batchId, batches.id))
        .where(eq(zoomLinks.batchId, batchId))
        .limit(1);
        
      return NextResponse.json(zoomLink[0] || null);
    } else {
      // Get all zoom links
      const allZoomLinks = await db
        .select({
          zoomLink: zoomLinks,
          batch: {
            id: batches.id,
            batchName: batches.batchName
          }
        })
        .from(zoomLinks)
        .leftJoin(batches, eq(zoomLinks.batchId, batches.id));
        
      return NextResponse.json(allZoomLinks);
    }
  } catch (error) {
    console.error('Error fetching zoom link:', error);
    return NextResponse.json({ error: 'Failed to fetch zoom link' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { url, batchId } = await request.json();

    if (!url || !batchId) {
      return NextResponse.json({ error: 'URL and batch ID are required' }, { status: 400 });
    }

    const zoomMeetingId = parseZoomMeetingId(url);
    
    // Check if a zoom link exists for this specific batch
    const existingLink = await db
      .select()
      .from(zoomLinks)
      .where(eq(zoomLinks.batchId, batchId))
      .limit(1);
    
    if (existingLink.length > 0) {
      // Update the existing zoom link for this batch
      await db
        .update(zoomLinks)
        .set({
          url,
          zoomMeetingId,
          updatedAt: new Date()
        })
        .where(eq(zoomLinks.batchId, batchId));
        
      return NextResponse.json({ message: 'Zoom link updated successfully' }, { status: 200 });
    } else {
      // Create a new zoom link for this batch
      const newZoomLink = {
        id: uuidv4(),
        url,
        zoomMeetingId,
        batchId,
      };
      
      await db.insert(zoomLinks).values(newZoomLink);
      
      return NextResponse.json({ message: 'Zoom link created successfully' }, { status: 201 });
    }
  } catch (error) {
    console.error('Error creating/updating zoom link:', error);
    return NextResponse.json({ error: 'Failed to create/update zoom link' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    
    if (!batchId) {
      return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 });
    }
    
    // Delete the zoom link for the specific batch
    const result = await db
      .delete(zoomLinks)
      .where(eq(zoomLinks.batchId, batchId));
    
    return NextResponse.json({ message: 'Zoom link deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error('Error deleting zoom link:', error);
    return NextResponse.json({ error: 'Failed to delete zoom link' }, { status: 500 });
  }
} 