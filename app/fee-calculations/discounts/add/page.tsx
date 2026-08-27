'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AddDiscount() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    scope: 'student',
    userId: '',
    courseId: '',
    batchId: '',
    discountType: 'percentage',
    value: '',
    isActive: true,
    validFrom: '',
    validTo: '',
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/courses').then((r) => r.json()),
      fetch('/api/batches').then((r) => r.json()),
    ])
      .then(([u, c, b]) => {
        setUsers(u);
        setCourses(c);
        setBatches(b);
      })
      .catch((err) => console.error(err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fee-discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, value: parseInt(formData.value) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create discount');
      }
      router.push('/fee-calculations/discounts');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Add Discount / Scholarship</h1>
      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="mb-4 space-y-2">
              <Label>Name</Label>
              <Input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Need-based scholarship" required />
            </div>

            <div className="mb-4 space-y-2">
              <Label>Scope</Label>
              <select value={formData.scope} onChange={(e) => setFormData({ ...formData, scope: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
                <option value="student">Specific Student</option>
                <option value="batch">Whole Batch</option>
                <option value="course">Whole Course</option>
              </select>
            </div>

            {formData.scope === 'student' && (
              <div className="mb-4 space-y-2">
                <Label>Student</Label>
                <select value={formData.userId} onChange={(e) => setFormData({ ...formData, userId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50" required>
                  <option value="">Select a student</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
            )}

            {formData.scope === 'course' && (
              <div className="mb-4 space-y-2">
                <Label>Course</Label>
                <select value={formData.courseId} onChange={(e) => setFormData({ ...formData, courseId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50" required>
                  <option value="">Select a course</option>
                  {courses.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            )}

            {formData.scope === 'batch' && (
              <div className="mb-4 space-y-2">
                <Label>Batch</Label>
                <select value={formData.batchId} onChange={(e) => setFormData({ ...formData, batchId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50" required>
                  <option value="">Select a batch</option>
                  {batches.map((b: any) => (
                    <option key={b.batch?.id || b.id} value={b.batch?.id || b.id}>{b.batch?.batchName || b.batchName}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-4 space-y-2">
              <Label>Discount Type</Label>
              <select value={formData.discountType} onChange={(e) => setFormData({ ...formData, discountType: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (Rs.)</option>
              </select>
            </div>

            <div className="mb-4 space-y-2">
              <Label>{formData.discountType === 'percentage' ? 'Percent (%)' : 'Amount (Rs.)'}</Label>
              <Input type="number" value={formData.value} onChange={(e) => setFormData({ ...formData, value: e.target.value })} min="0" required />
            </div>

            <div className="flex gap-4 mb-4">
              <div className="flex-1 space-y-2">
                <Label>Valid From (optional)</Label>
                <Input type="date" value={formData.validFrom} onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })} />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Valid To (optional)</Label>
                <Input type="date" value={formData.validTo} onChange={(e) => setFormData({ ...formData, validTo: e.target.value })} />
              </div>
            </div>

            <div className="mb-6">
              <Label className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
                <span>Active</span>
              </Label>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Discount'}
              </Button>
              <Button type="button" onClick={() => router.push('/fee-calculations/discounts')} variant="secondary">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
