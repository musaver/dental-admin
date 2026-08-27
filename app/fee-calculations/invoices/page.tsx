'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatPKR } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'outline'> = {
  unpaid: 'secondary',
  partial: 'default',
  paid: 'success',
  waived: 'outline',
  refunded: 'destructive',
};

export default function InvoicesList() {
  const [rows, setRows] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ batchId: '', period: '', status: '' });

  const fetchRows = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.batchId) qs.set('batchId', filters.batchId);
      if (filters.period) qs.set('period', filters.period);
      if (filters.status) qs.set('status', filters.status);
      const res = await fetch(`/api/fee-invoices?${qs.toString()}`);
      setRows(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/batches').then((r) => r.json()).then(setBatches).catch(console.error);
  }, []);

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const badge = (status: string) => (
    <Badge variant={statusVariants[status] || 'secondary'}>{status}</Badge>
  );

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Fee Invoices</h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/fee-calculations">← Back</Link>
          </Button>
          <Button asChild>
            <Link href="/fee-calculations/invoices/add">Add Invoice</Link>
          </Button>
          <Button asChild variant="success">
            <Link href="/fee-calculations/generate">Generate Invoices</Link>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="space-y-1">
          <Label className="text-sm">Batch</Label>
          <select value={filters.batchId} onChange={(e) => setFilters({ ...filters, batchId: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">All batches</option>
            {batches.map((b: any) => (
              <option key={b.batch?.id} value={b.batch?.id}>{b.batch?.batchName}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Period (YYYY-MM)</Label>
          <Input type="month" value={filters.period} onChange={(e) => setFilters({ ...filters, period: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Status</Label>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">All</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="waived">Waived</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
        {(filters.batchId || filters.period || filters.status) && (
          <Button onClick={() => setFilters({ batchId: '', period: '', status: '' })} variant="secondary">Clear</Button>
        )}
      </div>

      {loading ? (
        <div className="p-4 text-muted-foreground">Loading...</div>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Student</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Batch</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? (
                rows.map((r) => {
                  const inv = r.invoice;
                  const balance = (inv.totalAmount || 0) - (inv.paidAmount || 0);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>{r.user?.name || r.user?.email || 'Unknown'}</TableCell>
                      <TableCell>{r.course?.title || '-'}</TableCell>
                      <TableCell>{r.batch?.batchName || '-'}</TableCell>
                      <TableCell>{inv.period}</TableCell>
                      <TableCell>{formatPKR(inv.totalAmount)}</TableCell>
                      <TableCell>{formatPKR(inv.paidAmount)}</TableCell>
                      <TableCell>{formatPKR(balance)}</TableCell>
                      <TableCell>{badge(inv.status)}</TableCell>
                      <TableCell>
                        <Button asChild size="sm">
                          <Link href={`/fee-calculations/invoices/${inv.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">No invoices found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
