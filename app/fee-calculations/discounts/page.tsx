'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatPKR } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function DiscountsList() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fee-discounts');
      setRows(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Delete this discount?')) {
      await fetch(`/api/fee-discounts/${id}`, { method: 'DELETE' });
      setRows(rows.filter((r) => r.discount.id !== id));
    }
  };

  const formatValue = (d: any) =>
    d.discountType === 'percentage' ? `${d.value}%` : formatPKR(d.value);

  const formatTarget = (r: any) => {
    if (r.discount.scope === 'student') return r.user?.name || r.user?.email || '—';
    if (r.discount.scope === 'course') return r.course?.title || '—';
    if (r.discount.scope === 'batch') return r.batch?.batchName || '—';
    return '—';
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Discounts &amp; Scholarships</h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/fee-calculations">← Back</Link>
          </Button>
          <Button asChild variant="success">
            <Link href="/fee-calculations/discounts/add">Add Discount</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Applies To</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((r) => (
                <TableRow key={r.discount.id}>
                  <TableCell>{r.discount.name}</TableCell>
                  <TableCell className="capitalize">{r.discount.scope}</TableCell>
                  <TableCell>{formatTarget(r)}</TableCell>
                  <TableCell>{formatValue(r.discount)}</TableCell>
                  <TableCell>{r.discount.isActive ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/fee-calculations/discounts/edit/${r.discount.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(r.discount.id)} size="sm" variant="destructive">Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">No discounts found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
