'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AddFeeStructure() {
  const router = useRouter();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    courseId: '',
    name: '',
    billingCycle: 'monthly',
    baseAmount: '',
    dueDayOfMonth: '',
    isActive: true,
  });

  useEffect(() => {
    fetch('/api/courses')
      .then((res) => res.json())
      .then((data) => setCourses(data))
      .catch((err) => console.error(err));
  }, []);

  const selectedCourse = courses.find((c: any) => c.id === formData.courseId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/fee-structures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          baseAmount: formData.baseAmount === '' ? undefined : parseInt(formData.baseAmount),
          dueDayOfMonth: formData.dueDayOfMonth === '' ? null : parseInt(formData.dueDayOfMonth),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create fee structure');
      }
      router.push('/fee-calculations/structures');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Add Fee Structure</h1>
      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="mb-4 space-y-2">
              <Label>Course</Label>
              <select
                value={formData.courseId}
                onChange={(e) => setFormData({ ...formData, courseId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="">Select a course</option>
                {courses.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.title} (Rs.{Number(c.price).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4 space-y-2">
              <Label>Name</Label>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Monthly Tuition"
                required
              />
            </div>

            <div className="mb-4 space-y-2">
              <Label>Billing Cycle</Label>
              <select
                value={formData.billingCycle}
                onChange={(e) => setFormData({ ...formData, billingCycle: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="monthly">Monthly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>

            <div className="mb-4 space-y-2">
              <Label>
                Base Amount (Rs.){' '}
                <span className="text-muted-foreground text-sm">
                  {selectedCourse ? `— defaults to course price Rs.${Number(selectedCourse.price).toFixed(2)} if blank` : '— defaults to course price if blank'}
                </span>
              </Label>
              <Input
                type="number"
                value={formData.baseAmount}
                onChange={(e) => setFormData({ ...formData, baseAmount: e.target.value })}
                min="0"
                placeholder={selectedCourse ? String(selectedCourse.price) : ''}
              />
            </div>

            <div className="mb-4 space-y-2">
              <Label>Due Day of Month (optional)</Label>
              <Input
                type="number"
                value={formData.dueDayOfMonth}
                onChange={(e) => setFormData({ ...formData, dueDayOfMonth: e.target.value })}
                min="1"
                max="31"
                placeholder="e.g. 5"
              />
            </div>

            <div className="mb-6">
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                />
                <span>Active</span>
              </Label>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Fee Structure'}
              </Button>
              <Button type="button" onClick={() => router.push('/fee-calculations/structures')} variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
