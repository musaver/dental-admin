'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { formatPKR } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function EditFeeStructure() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [components, setComponents] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    billingCycle: 'monthly',
    baseAmount: '',
    dueDayOfMonth: '',
    isActive: true,
  });
  const [newComponent, setNewComponent] = useState({ name: '', amount: '', frequency: 'recurring' });

  const load = async () => {
    try {
      const res = await fetch(`/api/fee-structures/${id}`);
      if (!res.ok) throw new Error('Failed to load fee structure');
      const data = await res.json();
      setFormData({
        name: data.name || '',
        billingCycle: data.billingCycle || 'monthly',
        baseAmount: String(data.baseAmount ?? ''),
        dueDayOfMonth: data.dueDayOfMonth != null ? String(data.dueDayOfMonth) : '',
        isActive: !!data.isActive,
      });
      setComponents(data.components || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/fee-structures/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          baseAmount: parseInt(formData.baseAmount),
          dueDayOfMonth: formData.dueDayOfMonth === '' ? null : parseInt(formData.dueDayOfMonth),
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      router.push('/fee-calculations/structures');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addComponent = async () => {
    if (!newComponent.name || newComponent.amount === '') return;
    const res = await fetch('/api/fee-components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeStructureId: id, ...newComponent, amount: parseInt(newComponent.amount) }),
    });
    if (res.ok) {
      const created = await res.json();
      setComponents([...components, created]);
      setNewComponent({ name: '', amount: '', frequency: 'recurring' });
    }
  };

  const deleteComponent = async (componentId: string) => {
    await fetch(`/api/fee-components/${componentId}`, { method: 'DELETE' });
    setComponents(components.filter((c) => c.id !== componentId));
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit Fee Structure</h1>
      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>}

      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={handleSave}>
            <div className="mb-4 space-y-2">
              <Label>Name</Label>
              <Input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
            </div>

            <div className="mb-4 space-y-2">
              <Label>Billing Cycle</Label>
              <select value={formData.billingCycle} onChange={(e) => setFormData({ ...formData, billingCycle: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
                <option value="monthly">Monthly</option>
                <option value="one_time">One-time</option>
              </select>
            </div>

            <div className="mb-4 space-y-2">
              <Label>Base Amount (Rs.)</Label>
              <Input type="number" value={formData.baseAmount} onChange={(e) => setFormData({ ...formData, baseAmount: e.target.value })} min="0" required />
            </div>

            <div className="mb-4 space-y-2">
              <Label>Due Day of Month (optional)</Label>
              <Input type="number" value={formData.dueDayOfMonth} onChange={(e) => setFormData({ ...formData, dueDayOfMonth: e.target.value })} min="1" max="31" />
            </div>

            <div className="mb-6">
              <Label className="flex items-center gap-2">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />
                <span>Active</span>
              </Label>
            </div>

            <div className="flex gap-4">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button type="button" onClick={() => router.push('/fee-calculations/structures')} variant="secondary">
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Inline component management */}
      <div className="mt-10 max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight mb-3">Extra Fee Components</h2>
        <p className="text-muted-foreground text-sm mb-3">
          Recurring components are billed every period; one-time components only on the first invoice.
        </p>

        <Card className="py-0 mb-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.length > 0 ? (
                components.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{formatPKR(c.amount)}</TableCell>
                    <TableCell>{c.frequency}</TableCell>
                    <TableCell>
                      <Button onClick={() => deleteComponent(c.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">No components</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-sm">Name</Label>
            <Input type="text" value={newComponent.name} onChange={(e) => setNewComponent({ ...newComponent, name: e.target.value })} placeholder="e.g. Exam Fee" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Amount (Rs.)</Label>
            <Input type="number" value={newComponent.amount} onChange={(e) => setNewComponent({ ...newComponent, amount: e.target.value })} min="0" />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Frequency</Label>
            <select value={newComponent.frequency} onChange={(e) => setNewComponent({ ...newComponent, frequency: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
              <option value="recurring">Recurring</option>
              <option value="one_time">One-time</option>
            </select>
          </div>
          <Button type="button" onClick={addComponent} variant="success">
            Add Component
          </Button>
        </div>
      </div>
    </div>
  );
}
