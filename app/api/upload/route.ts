import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const directory = formData.get('directory') as string || 'general';
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.' 
      }, { status: 400 });
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: 'File too large. Maximum size is 5MB.' 
      }, { status: 400 });
    }

    // Validate directory parameter
    const allowedDirectories = ['logos', 'signatures', 'general'];
    if (!allowedDirectories.includes(directory)) {
      return NextResponse.json({
        error: `Invalid directory. Allowed directories: ${allowedDirectories.join(', ')}`,
      }, { status: 400 });
    }

    // Generate unique filename with directory structure
    const timestamp = Date.now();
    const fileName = `${directory}/${timestamp}-${file.name}`;

    // NOTE: `access: 'public'` is acceptable only for the non-clinical
    // directories allow-listed above (clinic logos, staff signatures).
    // Patient files — X-rays, intraoral photos, consent scans — must NOT use
    // this route: they need private blobs behind a signed-URL proxy, plus
    // client-side direct upload to get past Vercel's 4.5 MB request body cap.
    const blob = await put(fileName, file, {
      access: 'public',
    });

    return NextResponse.json({ 
      url: blob.url,
      fileName: fileName 
    });

  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
} 