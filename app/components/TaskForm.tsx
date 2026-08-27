'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploader from '@/app/components/ImageUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface TaskFormData {
  title: string;
  description: string;
  classId: string;
  dueDate: string;
  status: string;
  priority: string;
  attachmentUrl: string;
}

interface TaskFormProps {
  mode: 'add' | 'edit';
  taskId?: string;
  initialData?: Partial<TaskFormData>;
}

const empty: TaskFormData = {
  title: '',
  description: '',
  classId: '',
  dueDate: '',
  status: 'open',
  priority: 'normal',
  attachmentUrl: '',
};

export default function TaskForm({ mode, taskId, initialData }: TaskFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<TaskFormData>({ ...empty, ...initialData });
  const [classes, setClasses] = useState<any[]>([]);
  const [sendAnnouncement, setSendAnnouncement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/classes')
      .then((res) => res.json())
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch((err) => {
        console.error(err);
        setError('Failed to load classes');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.title.trim() || !formData.classId) {
      setError('Title and class are required.');
      return;
    }
    setSubmitting(true);
    try {
      const url = mode === 'add' ? '/api/tasks' : `/api/tasks/${taskId}`;
      const method = mode === 'add' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, sendAnnouncement }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save task');
      }
      router.push('/tasks');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <div className="mb-4">
        <Label className="mb-2 block" htmlFor="title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={handleChange}
          required
        />
      </div>

      <div className="mb-4">
        <Label className="mb-2 block" htmlFor="classId">
          Class <span className="text-destructive">*</span>
        </Label>
        <select
          id="classId"
          name="classId"
          value={formData.classId}
          onChange={handleChange}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          required
        >
          <option value="">Select a class</option>
          {classes.map((item: any) => (
            <option key={item.class.id} value={item.class.id}>
              {item.class.title}
              {item.course?.title ? ` — ${item.course.title}` : ''}
              {item.batch?.batchName ? ` (${item.batch.batchName})` : ''}
            </option>
          ))}
        </select>
        {classes.length === 0 && (
          <p className="mt-1 text-sm text-amber-600">No classes found. Create a class first.</p>
        )}
      </div>

      <div className="mb-4">
        <Label className="mb-2 block" htmlFor="description">
          Description
        </Label>
        <Textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={4}
          placeholder="What should students do?"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="dueDate">
            Due Date
          </Label>
          <Input
            type="datetime-local"
            id="dueDate"
            name="dueDate"
            value={formData.dueDate}
            onChange={handleChange}
          />
        </div>
        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="priority">
            Priority
          </Label>
          <select
            id="priority"
            name="priority"
            value={formData.priority}
            onChange={handleChange}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="status">
            Status
          </Label>
          <select
            id="status"
            name="status"
            value={formData.status}
            onChange={handleChange}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="mb-4">
        <ImageUploader
          currentImage={formData.attachmentUrl}
          onImageUpload={(u) => setFormData((prev) => ({ ...prev, attachmentUrl: u }))}
          onImageRemove={() => setFormData((prev) => ({ ...prev, attachmentUrl: '' }))}
          label="Attachment (optional image)"
          disabled={submitting}
          directory="general"
        />
      </div>

      <div className="mb-6 rounded-lg border bg-muted/40 p-3">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={sendAnnouncement}
            onChange={(e) => setSendAnnouncement(e.target.checked)}
            className="mr-2"
          />
          <span className="text-muted-foreground">Send announcement for this task</span>
        </label>
        <p className="mt-1 text-sm text-muted-foreground ml-6">
          Notifies the class's enrolled students (bell + News) and also emails them.
        </p>
      </div>

      <div className="flex gap-4">
        <Button
          type="submit"
          disabled={submitting}
        >
          {submitting ? 'Saving…' : mode === 'add' ? 'Create Task' : 'Save Changes'}
        </Button>
        <Button
          type="button"
          onClick={() => router.push('/tasks')}
          variant="secondary"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
