'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function GenerateInvoices() {
  const [batches, setBatches] = useState<any[]>([]);
  const [batchId, setBatchId] = useState('');
  const [period, setPeriod] = useState(currentMonth());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/batches').then((r) => r.json()).then(setBatches).catch(console.error);
  }, []);

  const generate = async () => {
    if (!batchId || !period) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/fee-invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, period }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Generate Monthly Invoices</h1>
        <Button asChild variant="secondary">
          <Link href="/fee-calculations">← Back</Link>
        </Button>
      </div>

      <p className="text-muted-foreground mb-4 max-w-2xl">
        Creates one invoice per enrolled student (completed orders) in the selected batch for the chosen
        month, snapshotting the fee structure&apos;s base + components minus any applicable discounts.
        Re-running is safe — students who already have an invoice for the period are skipped.
      </p>

      {error && <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive max-w-lg">{error}</div>}

      <div className="max-w-lg">
        <div className="mb-4 space-y-2">
          <Label>Batch</Label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">Select a batch</option>
            {batches.map((b: any) => (
              <option key={b.batch?.id} value={b.batch?.id}>
                {b.batch?.batchName} {b.course?.title ? `— ${b.course.title}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6 space-y-2">
          <Label>Period</Label>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>

        <Button onClick={generate} disabled={running || !batchId}>
          {running ? 'Generating...' : 'Generate Invoices'}
        </Button>
      </div>

      {result && (
        <Card className="mt-6 max-w-lg">
          <CardContent>
            <p className="font-semibold text-primary">Done</p>
            <ul className="mt-2 text-sm text-muted-foreground">
              <li>Enrolled students: {result.enrolled}</li>
              <li>Invoices created: {result.created}</li>
              <li>Skipped (already existed): {result.skipped}</li>
            </ul>
            <Button asChild size="sm" className="mt-3">
              <Link href={`/fee-calculations/invoices?batchId=${batchId}&period=${period}`}>
                View invoices
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
