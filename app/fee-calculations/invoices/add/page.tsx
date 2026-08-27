'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AddInvoice() {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    userId: '',
    courseId: '',
    batchId: '',
    period: currentMonth(),
    baseAmount: '',
    componentsTotal: '',
    discountTotal: '',
    dueDate: '',
    notes: '',
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

  // When a course is picked, default the base amount to its price (if blank).
  const handleCourse = (courseId: string) => {
    const course = courses.find((c: any) => c.id === courseId);
    setFormData((f) => ({
      ...f,
      courseId,
      baseAmount: f.baseAmount === '' && course ? String(course.price) : f.baseAmount,
    }));
  };

  const base = parseInt(formData.baseAmount || '0') || 0;
  const comp = parseInt(formData.componentsTotal || '0') || 0;
  const disc = parseInt(formData.discountTotal || '0') || 0;
  const total = Math.max(0, base + comp - disc);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fee-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: formData.userId,
          courseId: formData.courseId,
          batchId: formData.batchId || null,
          period: formData.period,
          baseAmount: base,
          componentsTotal: comp,
          discountTotal: disc,
          dueDate: formData.dueDate || null,
          notes: formData.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invoice');
      router.push(`/fee-calculations/invoices/${data.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Add Invoice (manual)</h1>
        <Button asChild variant="secondary">
          <Link href="/fee-calculations/invoices">← Back</Link>
        </Button>
      </div>

      <p className="text-muted-foreground mb-4 max-w-lg text-sm">
        Use this to create a one-off invoice for a single student. For routine monthly billing of a whole
        batch, use <Link href="/fee-calculations/generate" className="text-primary underline underline-offset-4">Generate Invoices</Link> instead.
      </p>

      {error && (
        <div className="mb-4 max-w-lg rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Student</Label>
              <select value={formData.userId} onChange={(e) => setFormData({ ...formData, userId: e.target.value })} className={selectClass} required>
                <option value="">Select a student</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Course</Label>
              <select value={formData.courseId} onChange={(e) => handleCourse(e.target.value)} className={selectClass} required>
                <option value="">Select a course</option>
                {courses.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.title} (Rs.{Number(c.price).toFixed(2)})</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Batch (optional)</Label>
              <select value={formData.batchId} onChange={(e) => setFormData({ ...formData, batchId: e.target.value })} className={selectClass}>
                <option value="">No batch</option>
                {batches.map((b: any) => (
                  <option key={b.batch?.id} value={b.batch?.id}>{b.batch?.batchName}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Period</Label>
              <Input type="month" value={formData.period} onChange={(e) => setFormData({ ...formData, period: e.target.value })} required />
            </div>

            <div className="flex gap-4">
              <div className="flex-1 space-y-2">
                <Label>Base Amount (Rs.)</Label>
                <Input type="number" value={formData.baseAmount} onChange={(e) => setFormData({ ...formData, baseAmount: e.target.value })} min="0" required />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Components (Rs.)</Label>
                <Input type="number" value={formData.componentsTotal} onChange={(e) => setFormData({ ...formData, componentsTotal: e.target.value })} min="0" />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Discount (Rs.)</Label>
                <Input type="number" value={formData.discountTotal} onChange={(e) => setFormData({ ...formData, discountTotal: e.target.value })} min="0" />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/50 p-3 text-sm">
              Total payable: <span className="font-semibold">Rs. {total.toFixed(2)}</span>
            </div>

            <div className="space-y-2">
              <Label>Due Date (optional)</Label>
              <Input type="date" value={formData.dueDate} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
            </div>

            <div className="flex gap-4 pt-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Invoice'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => router.push('/fee-calculations/invoices')}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
