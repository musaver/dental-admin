'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ClassFormData {
  title: string;
  courseId: string;
  batchId: string;
  description: string;
  scheduledAt: string;
  durationMinutes: string | number;
  zoomLink: string;
  zoomMeetingId: string;
  zoomPasscode: string;
  recordingUrl: string;
  status: string;
  showToAllUsers: boolean;
}

interface ClassFormProps {
  mode: 'add' | 'edit';
  initialData?: Partial<ClassFormData>;
  classId?: string;
}

const emptyForm: ClassFormData = {
  title: '',
  courseId: '',
  batchId: '',
  description: '',
  scheduledAt: '',
  durationMinutes: 60,
  zoomLink: '',
  zoomMeetingId: '',
  zoomPasscode: '',
  recordingUrl: '',
  status: 'scheduled',
  showToAllUsers: true,
};

export default function ClassForm({ mode, initialData, classId }: ClassFormProps) {
  const router = useRouter();
  const [formData, setFormData] = useState<ClassFormData>({ ...emptyForm, ...initialData });
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/courses').then((res) => res.json()),
      fetch('/api/batches').then((res) => res.json()),
    ])
      .then(([coursesData, batchesData]) => {
        setCourses(Array.isArray(coursesData) ? coursesData : []);
        setBatches(Array.isArray(batchesData) ? batchesData : []);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load courses and batches');
      })
      .finally(() => setLoading(false));
  }, []);

  // Batches filtered by the currently selected course
  const filteredBatches = formData.courseId
    ? batches.filter((item: any) => item.batch.courseId === formData.courseId)
    : batches;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checkbox = e.target as HTMLInputElement;
      setFormData((prev) => ({ ...prev, [name]: checkbox.checked }));
      return;
    }

    if (name === 'courseId') {
      // Reset the batch when the course changes so we don't keep a mismatched batch
      setFormData((prev) => ({ ...prev, courseId: value, batchId: '' }));
      return;
    }

    if (name === 'batchId') {
      // Auto-fill course from the chosen batch (in case course wasn't picked first)
      const selected = batches.find((item: any) => item.batch.id === value);
      setFormData((prev) => ({
        ...prev,
        batchId: value,
        courseId: selected?.batch.courseId || prev.courseId,
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const url = mode === 'add' ? '/api/classes' : `/api/classes/${classId}`;
      const method = mode === 'add' ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save class');
      }

      router.push('/classes');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">{mode === 'add' ? 'Add New Class' : 'Edit Class'}</h1>

      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="title">
            Class Title <span className="text-destructive">*</span>
          </Label>
          <Input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="e.g. Class 1 — Introduction to Tajweed"
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="courseId">
              Course <span className="text-destructive">*</span>
            </Label>
            <select
              id="courseId"
              name="courseId"
              value={formData.courseId}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              required
            >
              <option value="">Select a course</option>
              {courses.map((course: any) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="batchId">
              Batch <span className="text-destructive">*</span>
            </Label>
            <select
              id="batchId"
              name="batchId"
              value={formData.batchId}
              onChange={handleChange}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              required
            >
              <option value="">Select a batch</option>
              {filteredBatches.map((item: any) => (
                <option key={item.batch.id} value={item.batch.id}>
                  {item.batch.batchName}
                  {item.course?.title ? ` — ${item.course.title}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="scheduledAt">
              Scheduled Date &amp; Time <span className="text-destructive">*</span>
            </Label>
            <Input
              type="datetime-local"
              id="scheduledAt"
              name="scheduledAt"
              value={formData.scheduledAt}
              onChange={handleChange}
              required
            />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="durationMinutes">
              Duration (minutes)
            </Label>
            <Input
              type="number"
              id="durationMinutes"
              name="durationMinutes"
              min={0}
              value={formData.durationMinutes}
              onChange={handleChange}
              placeholder="60"
            />
          </div>
        </div>

        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="zoomLink">
            Zoom / Meeting Link
          </Label>
          <Input
            type="url"
            id="zoomLink"
            name="zoomLink"
            value={formData.zoomLink}
            onChange={handleChange}
            placeholder="https://zoom.us/j/123456789"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="zoomMeetingId">
              Zoom Meeting ID
            </Label>
            <Input
              type="text"
              id="zoomMeetingId"
              name="zoomMeetingId"
              value={formData.zoomMeetingId}
              onChange={handleChange}
              placeholder="123 4567 8901"
            />
          </div>

          <div className="mb-4">
            <Label className="mb-2 block" htmlFor="zoomPasscode">
              Zoom Passcode
            </Label>
            <Input
              type="text"
              id="zoomPasscode"
              name="zoomPasscode"
              value={formData.zoomPasscode}
              onChange={handleChange}
              placeholder="optional"
            />
          </div>
        </div>

        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="recordingUrl">
            Recording URL
          </Label>
          <Input
            type="url"
            id="recordingUrl"
            name="recordingUrl"
            value={formData.recordingUrl}
            onChange={handleChange}
            placeholder="https://example.com/recording (added after the class)"
          />
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
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="mb-4">
          <Label className="mb-2 block" htmlFor="description">
            Description / Topic
          </Label>
          <Textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            placeholder="What will be covered in this class?"
          />
        </div>

        <div className="mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              name="showToAllUsers"
              checked={formData.showToAllUsers}
              onChange={handleChange}
              className="mr-2"
            />
            <span className="text-muted-foreground">Visible to enrolled students</span>
          </label>
        </div>

        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? mode === 'add'
                ? 'Creating...'
                : 'Saving...'
              : mode === 'add'
              ? 'Create Class'
              : 'Save Changes'}
          </Button>
          <Button
            type="button"
            onClick={() => router.push('/classes')}
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
