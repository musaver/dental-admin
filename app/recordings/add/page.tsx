'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AddRecording() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    recordingTitle: '',
    classId: '',
    batchId: '',
    recordingDateTime: '',
    recordingUrl: '',
    showToAllUsers: true
  });
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/classes')
      .then(res => res.json())
      .then(data => {
        setClasses(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load classes');
        setLoading(false);
      });
  }, []);

  const selected = classes.find((item: any) => item.class.id === formData.classId);

  const formatForInput = (dateString: string) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checkbox = e.target as HTMLInputElement;
      setFormData(prev => ({ ...prev, [name]: checkbox.checked }));
      return;
    }

    if (name === 'classId') {
      const cls = classes.find((item: any) => item.class.id === value);
      setFormData(prev => ({
        ...prev,
        classId: value,
        batchId: cls?.class.batchId || '',
        // Auto-fill date and title from the class when they're still empty
        recordingDateTime: prev.recordingDateTime || (cls ? formatForInput(cls.class.scheduledAt) : ''),
        recordingTitle: prev.recordingTitle || (cls ? cls.class.title : ''),
      }));
      return;
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create recording');
      }

      router.push('/recordings');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Add New Recording</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="classId">
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
              {selected && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Batch: <span className="font-medium">{selected.batch?.batchName || '—'}</span>
                  {' · '}Course: <span className="font-medium">{selected.course?.title || '—'}</span>
                </p>
              )}
              {classes.length === 0 && (
                <p className="mt-1 text-sm text-amber-600">
                  No classes found. Create a class first under the Classes module.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="recordingTitle">
                Recording Title <span className="text-destructive">*</span>
              </Label>
              <Input
                type="text"
                id="recordingTitle"
                name="recordingTitle"
                value={formData.recordingTitle}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recordingDateTime">
                Recording Date & Time <span className="text-destructive">*</span>
              </Label>
              <Input
                type="datetime-local"
                id="recordingDateTime"
                name="recordingDateTime"
                value={formData.recordingDateTime}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="recordingUrl">
                Recording URL
              </Label>
              <Input
                type="url"
                id="recordingUrl"
                name="recordingUrl"
                value={formData.recordingUrl}
                onChange={handleChange}
                placeholder="https://example.com/recording"
              />
              <p className="mt-1 text-sm text-muted-foreground">
                This URL is also saved onto the linked class so students see it under “My Classes”.
              </p>
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
                <span className="text-muted-foreground">Show recording to all users</span>
              </label>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Recording'}
              </Button>
              <Button type="button" onClick={() => router.push('/recordings')} variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
