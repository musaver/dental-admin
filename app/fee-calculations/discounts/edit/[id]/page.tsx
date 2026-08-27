'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

export default function EditDiscount() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [users, setUsers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const toDateInput = (v: any) => (v ? new Date(v).toISOString().slice(0, 10) : '');

  useEffect(() => {
    Promise.all([
      fetch(`/api/fee-discounts/${id}`).then((r) => r.json()),
      fetch('/api/users').then((r) => r.json()),
      fetch('/api/courses').then((r) => r.json()),
      fetch('/api/batches').then((r) => r.json()),
    ])
      .then(([d, u, c, b]) => {
        setUsers(u);
        setCourses(c);
        setBatches(b);
        setFormData({
          name: d.name || '',
          scope: d.scope || 'student',
          userId: d.userId || '',
          courseId: d.courseId || '',
          batchId: d.batchId || '',
          discountType: d.discountType || 'percentage',
          value: String(d.value ?? ''),
          isActive: !!d.isActive,
          validFrom: toDateInput(d.validFrom),
          validTo: toDateInput(d.validTo),
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/fee-discounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, value: parseInt(formData.value) }),
      });
      if (!res.ok) throw new Error('Failed to save');
      router.push('/fee-calculations/discounts');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit Discount / Scholarship</h1>
      {error && (
        <div className="mb-4 max-w-lg rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>

            <div className="space-y-2">
              <Label>Scope</Label>
              <select value={formData.scope} onChange={(e) => setFormData({ ...formData, scope: e.target.value })} className={selectClass}>
                <option value="student">Specific Student</option>
                <option value="batch">Whole Batch</option>
                <option value="course">Whole Course</option>
              </select>
            </div>

            {formData.scope === 'student' && (
              <div className="space-y-2">
                <Label>Student</Label>
                <select value={formData.userId} onChange={(e) => setFormData({ ...formData, userId: e.target.value })} className={selectClass} required>
                  <option value="">Select a student</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
            )}

            {formData.scope === 'course' && (
              <div className="space-y-2">
                <Label>Course</Label>
                <select value={formData.courseId} onChange={(e) => setFormData({ ...formData, courseId: e.target.value })} className={selectClass} required>
                  <option value="">Select a course</option>
                  {courses.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
            )}

            {formData.scope === 'batch' && (
              <div className="space-y-2">
                <Label>Batch</Label>
                <select value={formData.batchId} onChange={(e) => setFormData({ ...formData, batchId: e.target.value })} className={selectClass} required>
                  <option value="">Select a batch</option>
                  {batches.map((b: any) => (
                    <option key={b.batch?.id || b.id} value={b.batch?.id || b.id}>{b.batch?.batchName || b.batchName}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Discount Type</Label>
              <select value={formData.discountType} onChange={(e) => setFormData({ ...formData, discountType: e.target.value })} className={selectClass}>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed Amount (Rs.)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>{formData.discountType === 'percentage' ? 'Percent (%)' : 'Amount (Rs.)'}</Label>
              <Input type="number" value={formData.value} onChange={(e) => setFormData({ ...formData, value: e.target.value })} min="0" required />
            </div>

            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label>Valid From (optional)</Label>
                <Input type="date" value={formData.validFrom} onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })} />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Valid To (optional)</Label>
                <Input type="date" value={formData.validTo} onChange={(e) => setFormData({ ...formData, validTo: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="accent-primary" />
                <span className="text-foreground text-sm">Active</span>
              </label>
            </div>

            <div className="flex gap-4 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.push('/fee-calculations/discounts')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
