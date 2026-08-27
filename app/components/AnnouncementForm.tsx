'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploader from '@/app/components/ImageUploader';
import RecipientPicker from '@/app/components/RecipientPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface AnnouncementInitialData {
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  courseId: string;
  batchId: string;
  status: string;
  recipientIds: string[];
}

interface AnnouncementFormProps {
  mode: 'add' | 'edit';
  announcementId?: string;
  initialData?: Partial<AnnouncementInitialData>;
}

export default function AnnouncementForm({ mode, announcementId, initialData }: AnnouncementFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState(initialData?.title || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [url, setUrl] = useState(initialData?.url || '');
  const [imageUrl, setImageUrl] = useState(initialData?.imageUrl || '');
  const [courseId, setCourseId] = useState(initialData?.courseId || '');
  const [batchId, setBatchId] = useState(initialData?.batchId || '');
  const [status, setStatus] = useState(initialData?.status || 'published');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialData?.recipientIds || [])
  );
  // On add: default email on. On edit: default off (avoid accidental re-send).
  const [sendEmail, setSendEmail] = useState(mode === 'add');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one recipient.');
      return;
    }

    setSubmitting(true);
    try {
      const audience = batchId ? 'batch' : courseId ? 'course' : 'all';
      const payload = {
        title,
        description,
        url,
        imageUrl,
        audience,
        courseId: courseId || null,
        batchId: batchId || null,
        status,
        recipientIds: Array.from(selected),
        sendEmail,
      };

      const apiUrl = mode === 'add' ? '/api/announcements' : `/api/announcements/${announcementId}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const res = await fetch(apiUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save announcement');
      }

      router.push('/announcements');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">
        {mode === 'add' ? 'New Announcement' : 'Edit Announcement'}
      </h1>

      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
        <div>
          <Label className="mb-2 block" htmlFor="title">
            Title <span className="text-destructive">*</span>
          </Label>
          <Input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div>
          <Label className="mb-2 block" htmlFor="description">
            Description
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Write the announcement message…"
          />
        </div>

        <div>
          <Label className="mb-2 block" htmlFor="url">
            Link URL
          </Label>
          <Input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/more-info"
          />
        </div>

        <div>
          <ImageUploader
            currentImage={imageUrl}
            onImageUpload={(u) => setImageUrl(u)}
            onImageRemove={() => setImageUrl('')}
            label="Image (optional)"
            disabled={submitting}
            directory="general"
          />
        </div>

        <RecipientPicker
          selected={selected}
          onChange={setSelected}
          courseId={courseId}
          batchId={batchId}
          onCourseChange={setCourseId}
          onBatchChange={setBatchId}
          autoSelectAllOnFirstLoad={mode === 'add'}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="mb-2 block" htmlFor="status">
              Status
            </Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="mr-2"
              />
              <span className="text-muted-foreground">
                Send email to recipients {mode === 'edit' ? 'now (re-send)' : ''}
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-4 pt-2">
          <Button
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? 'Saving…'
              : mode === 'add'
              ? sendEmail
                ? 'Create & Send'
                : 'Create'
              : 'Save Changes'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push('/announcements')}
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
