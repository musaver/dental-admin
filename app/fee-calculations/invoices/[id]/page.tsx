'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { formatPKR } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

export default function InvoiceDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState({
    amount: '',
    type: 'payment',
    method: 'cash',
    transactionId: '',
    paymentDate: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [details, setDetails] = useState({ dueDate: '', notes: '' });
  const [savingDetails, setSavingDetails] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/fee-invoices/${id}`);
      if (!res.ok) throw new Error('Failed to load invoice');
      const json = await res.json();
      setData(json);
      setDetails({
        dueDate: json.invoice?.dueDate ? new Date(json.invoice.dueDate).toISOString().slice(0, 10) : '',
        notes: json.invoice?.notes || '',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      const res = await fetch(`/api/fee-invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: details.dueDate || null, notes: details.notes }),
      });
      if (!res.ok) throw new Error('Failed to save details');
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingDetails(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const recordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (payment.amount === '' || Number(payment.amount) <= 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/fee-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, ...payment, amount: parseInt(payment.amount) }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to record payment');
      }
      setPayment({ amount: '', type: 'payment', method: 'cash', transactionId: '', paymentDate: '', notes: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const deletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment?')) return;
    await fetch(`/api/fee-payments/${paymentId}`, { method: 'DELETE' });
    await load();
  };

  const setStatus = async (status: string) => {
    if (!confirm(`Mark this invoice as "${status}"?`)) return;
    await fetch(`/api/fee-invoices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
  };

  const deleteInvoice = async () => {
    if (!confirm('Delete this invoice and all its payments? This cannot be undone.')) return;
    await fetch(`/api/fee-invoices/${id}`, { method: 'DELETE' });
    router.push('/fee-calculations/invoices');
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-4 text-destructive">{error}</div>;
  if (!data) return <div className="p-4">Not found</div>;

  const inv = data.invoice;
  const balance = (inv.totalAmount || 0) - (inv.paidAmount || 0);

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Invoice — {data.user?.name || data.user?.email || 'Student'}</h1>
        <Button asChild variant="secondary">
          <Link href="/fee-calculations/invoices">← Back</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Student</span><span>{data.user?.name || '-'} ({data.user?.email || '-'})</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Course</span><span>{data.course?.title || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Batch</span><span>{data.batch?.batchName || '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Period</span><span>{inv.period}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span>{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}</span></div>
              <div className="flex justify-between items-center"><span className="text-muted-foreground">Status</span><Badge variant={statusVariants[inv.status] || 'secondary'}>{inv.status}</Badge></div>
            </div>

            <div className="mt-4 border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Base</span><span>{formatPKR(inv.baseAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Components</span><span>{formatPKR(inv.componentsTotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>- {formatPKR(inv.discountTotal)}</span></div>
              <div className="flex justify-between font-semibold"><span>Total</span><span>{formatPKR(inv.totalAmount)}</span></div>
              <div className="flex justify-between text-emerald-600"><span>Paid</span><span>{formatPKR(inv.paidAmount)}</span></div>
              <div className="flex justify-between font-semibold"><span>Balance</span><span>{formatPKR(balance)}</span></div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {inv.status !== 'waived' && (
                <Button onClick={() => setStatus('waived')} variant="secondary" size="sm">Waive</Button>
              )}
              {inv.status === 'waived' && (
                <Button onClick={() => setStatus('unpaid')} variant="secondary" size="sm">Un-waive</Button>
              )}
              <Button onClick={deleteInvoice} variant="destructive" size="sm">Delete Invoice</Button>
            </div>

            {/* Edit due date + notes */}
            <form onSubmit={saveDetails} className="mt-4 border-t pt-3 space-y-3">
              <h3 className="font-semibold text-sm">Edit Details</h3>
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Due Date</Label>
                <Input type="date" id="dueDate" value={details.dueDate} onChange={(e) => setDetails({ ...details, dueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detailNotes">Notes</Label>
                <Textarea id="detailNotes" value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} rows={2} />
              </div>
              <Button type="submit" size="sm" disabled={savingDetails}>
                {savingDetails ? 'Saving...' : 'Save Details'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Line items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items?.map((it: any) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.label}</TableCell>
                    <TableCell className="capitalize">{it.itemType}</TableCell>
                    <TableCell className="text-right">{formatPKR(it.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Payments */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight mb-3">Payment History</h2>
        <Card className="py-0 mb-4">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Txn ID</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.payments?.length > 0 ? (
                data.payments.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : '-'}</TableCell>
                    <TableCell className="capitalize">{p.type}</TableCell>
                    <TableCell>{p.method || '-'}</TableCell>
                    <TableCell>{p.transactionId || '-'}</TableCell>
                    <TableCell className={`text-right ${p.type === 'refund' ? 'text-destructive' : ''}`}>
                      {p.type === 'refund' ? '- ' : ''}{formatPKR(p.amount)}
                    </TableCell>
                    <TableCell>{p.notes || '-'}</TableCell>
                    <TableCell>
                      <Button onClick={() => deletePayment(p.id)} variant="destructive" size="sm">Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No payments yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {/* Record payment / refund */}
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-base">Record Payment / Refund</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={recordPayment} className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select value={payment.type} onChange={(e) => setPayment({ ...payment, type: e.target.value })} className={selectClass}>
                  <option value="payment">Payment</option>
                  <option value="refund">Refund</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (Rs.)</Label>
                <Input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} min="1" required />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} className={selectClass}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Txn ID</Label>
                <Input type="text" value={payment.transactionId} onChange={(e) => setPayment({ ...payment, transactionId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={payment.paymentDate} onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} />
              </div>
              <div className="flex-1 min-w-[160px] space-y-1.5">
                <Label>Notes</Label>
                <Input type="text" value={payment.notes} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} />
              </div>
              <Button type="submit" variant="success" disabled={submitting}>
                {submitting ? 'Saving...' : 'Record'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
