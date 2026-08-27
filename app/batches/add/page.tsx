'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ImageUploader from '../../components/ImageUploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function AddBatch() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    batchName: '',
    courseId: '',
    startDate: '',
    endDate: '',
    capacity: '',
    description: '',
    image: ''
  });
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/courses')
      .then(res => res.json())
      .then(data => {
        setCourses(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load courses');
        setLoading(false);
      });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleImageUpload = (imageUrl: string) => {
    setFormData({
      ...formData,
      image: imageUrl
    });
  };

  const handleImageRemove = () => {
    setFormData({
      ...formData,
      image: ''
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const submitData = {
        ...formData,
        capacity: formData.capacity ? Number(formData.capacity) : null,
        startDate: formData.startDate || null,
        endDate: formData.endDate || null,
      };

      const response = await fetch('/api/batches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submitData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create batch');
      }

      router.push('/batches');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Add New Batch</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batchName">
                Batch Name <span className="text-destructive">*</span>
              </Label>
              <Input
                type="text"
                id="batchName"
                name="batchName"
                value={formData.batchName}
                onChange={handleChange}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="courseId">
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

            <div className="space-y-2">
              <Label htmlFor="startDate">
                Start Date
              </Label>
              <Input
                type="date"
                id="startDate"
                name="startDate"
                value={formData.startDate}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">
                End Date
              </Label>
              <Input
                type="date"
                id="endDate"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="capacity">
                Capacity
              </Label>
              <Input
                type="number"
                id="capacity"
                name="capacity"
                value={formData.capacity}
                onChange={handleChange}
                min="1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                Description
              </Label>
              <Textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={4}
              />
            </div>

            <div>
              <ImageUploader
                currentImage={formData.image}
                onImageUpload={handleImageUpload}
                onImageRemove={handleImageRemove}
                label="Batch Image"
                disabled={submitting}
                directory="batches"
              />
            </div>

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Creating...' : 'Create Batch'}
              </Button>
              <Button
                type="button"
                onClick={() => router.push('/batches')}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
