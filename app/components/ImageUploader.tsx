'use client';
import React, { useState, useRef } from 'react';
import imageCompression from 'browser-image-compression';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface ImageUploaderProps {
  currentImage?: string;
  onImageUpload: (imageUrl: string) => void;
  onImageRemove: () => void;
  label?: string;
  disabled?: boolean;
  directory?: 'courses' | 'batches' | 'general';
}

export default function ImageUploader({
  currentImage,
  onImageUpload,
  onImageRemove,
  label = "Upload Image",
  disabled = false,
  directory = 'general'
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 1, // Maximum file size in MB
      maxWidthOrHeight: 1920, // Maximum width or height
      useWebWorker: true,
      fileType: 'image/jpeg', // Convert to JPEG for better compression
    };

    try {
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error('Error compressing image:', error);
      return file; // Return original if compression fails
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Please select a valid image file (JPEG, PNG, or WebP)');
      return;
    }

    setUploading(true);

    try {
      // Create preview
      const previewUrl = URL.createObjectURL(file);
      setPreview(previewUrl);

      // Compress image
      const compressedFile = await compressImage(file);
      
      // Upload to server with directory parameter
      const formData = new FormData();
      formData.append('file', compressedFile);
      formData.append('directory', directory);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const { url } = await response.json();
      onImageUpload(url);
      
      // Clean up preview URL
      URL.revokeObjectURL(previewUrl);
      setPreview(url);

    } catch (error) {
      console.error('Error uploading image:', error);
      alert(`Error uploading image: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setPreview(currentImage || null);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    setPreview(null);
    onImageRemove();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <Label>{label}</Label>

      {preview && (
        <div className="relative inline-block">
          <img
            src={preview}
            alt="Preview"
            className="w-32 h-32 object-cover rounded-lg border"
          />
          <button
            type="button"
            onClick={handleRemoveImage}
            disabled={disabled || uploading}
            className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-destructive/90 disabled:opacity-50"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex items-center space-x-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={disabled || uploading}
          className="hidden"
          id="image-upload"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Uploading...
            </>
          ) : (
            <>
              <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
              </svg>
              {preview ? 'Change Image' : 'Select Image'}
            </>
          )}
        </Button>

        {preview && (
          <Button
            type="button"
            variant="outline"
            onClick={handleRemoveImage}
            disabled={disabled || uploading}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Remove
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Supports JPEG, PNG, WebP. Max size: 5MB. Images will be automatically compressed.
      </p>
    </div>
  );
} 