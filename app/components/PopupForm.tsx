'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import imageCompression from 'browser-image-compression';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PopupFormProps {
  mode: 'add' | 'edit';
  popupId?: string;
}

export default function PopupForm({ mode, popupId }: PopupFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode === 'edit' && popupId) {
      (async () => {
        try {
          const res = await fetch(`/api/popups/${popupId}`);
          if (!res.ok) throw new Error('Failed to load popup');
          const data = await res.json();
          setTitle(data.title || '');
          setIsActive(Boolean(data.isActive));
          setImages(Array.isArray(data.images) ? data.images : []);
        } catch (err) {
          console.error(err);
          setError('Failed to load popup');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [mode, popupId]);

  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/jpeg',
    };
    try {
      return await imageCompression(file, options);
    } catch (err) {
      console.error('Error compressing image:', err);
      return file;
    }
  };

  const uploadOne = async (file: File): Promise<string | null> => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert(`"${file.name}" is not a valid image (JPEG, PNG, or WebP).`);
      return null;
    }
    const compressed = await compressImage(file);
    const formData = new FormData();
    formData.append('file', compressed);
    formData.append('directory', 'general');

    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Upload failed');
    }
    const { url } = await response.json();
    return url;
  };

  const handleFilesChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const url = await uploadOne(file);
        if (url) uploaded.push(url);
      }
      if (uploaded.length > 0) {
        setImages((prev) => [...prev, ...uploaded]);
      }
    } catch (err) {
      console.error('Error uploading images:', err);
      alert(`Error uploading image: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please enter a title for the popup.');
      return;
    }
    if (images.length === 0) {
      setError('Please add at least one image.');
      return;
    }

    setSaving(true);
    try {
      const payload = { title: title.trim(), images, isActive };
      const url = mode === 'add' ? '/api/popups' : `/api/popups/${popupId}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save popup');
      }

      router.push('/popups');
      router.refresh();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save popup');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">
        {mode === 'add' ? 'Add Popup' : 'Edit Popup'}
      </h1>

      <Card className="max-w-2xl p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Summer Sale Popup"
              required
            />
          </div>

          <div className="space-y-3">
            <Label>Images</Label>

            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {images.map((img, index) => (
                  <div key={`${img}-${index}`} className="relative group">
                    <img
                      src={img}
                      alt={`Popup image ${index + 1}`}
                      className="w-full h-32 object-cover rounded-lg border"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      disabled={uploading || saving}
                      className="absolute -top-2 -right-2 bg-destructive text-white rounded-full w-6 h-6 flex items-center justify-center text-sm hover:bg-destructive/90 disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesChange}
              disabled={uploading || saving}
              className="hidden"
              id="popup-image-upload"
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading || saving}
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
                  Add Image(s)
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground">
              You can add a single image or select multiple images at once. Supports JPEG, PNG, WebP.
              Max size: 5MB each. Images are automatically compressed.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isActive"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="isActive" className="cursor-pointer">Active</Label>
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="success" disabled={saving || uploading}>
              {saving ? 'Saving...' : mode === 'add' ? 'Create Popup' : 'Save Changes'}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push('/popups')} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
