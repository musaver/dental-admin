'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api-client';
import { fmtDate, fmtDateTime } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { humanize, PAYMENT_METHOD, valuesOf } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';

interface InvoiceData {
  invoice: {
    id: string; invoiceNumber: string; issueDate: string; dueDate: string | null;
    subtotal: number; discountTotal: number; totalAmount: number; paidAmount: number;
    status: string; notes: string | null; patientId: string;
  };
  items: {
    id: string; description: string; teeth: string | null; quantity: number;
    unitPrice: number; discountAmount: number; amount: number; itemType: string;
  }[];
  payments: {
    id: string; amount: number; type: string; method: string | null;
    paymentDate: string; transactionId: string | null;
  }[];
  patient: { id: string; mrn: string; firstName: string; lastName: string | null; phone: string } | null;
  balance: number;
}

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payment, setPayment] = useState({ amount: '', method: 'cash', splitExcess: false });

  const load = useCallback(async () => {
    try {
      setData(await api.get<InvoiceData>(`/api/invoices/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the invoice.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function recordPayment() {
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/api/payments', {
        patientId: data.invoice.patientId,
        invoiceId: data.invoice.id,
        amount: Number(payment.amount),
        method: payment.method,
        splitExcess: payment.splitExcess,
      });
      setPaying(false);
      setPayment({ amount: '', method: 'cash', splitExcess: false });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OVERPAYMENT') {
        // Offer the split explicitly rather than failing.
        setPayment((p) => ({ ...p, splitExcess: true }));
        setError(
          `${err.message} Tick "keep the excess on account" to accept the rest as credit.`
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not record the payment.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function waive() {
    const reason = prompt('Why is this being written off? (recorded)');
    if (!reason?.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/api/invoices/${id}`, { reason: reason.trim() });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not waive the invoice.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return <div className="p-4"><div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div></div>;
  }
  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { invoice, balance } = data;
  const open = ['unpaid', 'partial'].includes(invoice.status);

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">{invoice.invoiceNumber}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.patient && (
              <Link href={`/patients/${data.patient.id}`} className="hover:underline">
                {patientName(data.patient)} ({data.patient.mrn})
              </Link>
            )}
            {' '}· issued {fmtDate(new Date(invoice.issueDate))}
            {invoice.dueDate ? ` · due ${fmtDate(new Date(invoice.dueDate))}` : ''}
          </p>
        </div>
        <Badge variant="secondary">{humanize(invoice.status)}</Badge>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <Card className="py-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-3 font-medium">Item</th>
              <th className="p-3 font-medium text-right">Qty</th>
              <th className="p-3 font-medium text-right">Unit</th>
              <th className="p-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.items.map((item) => (
              <tr key={item.id} className={item.itemType === 'discount' ? 'text-muted-foreground' : ''}>
                <td className="p-3">
                  {item.description}
                  {item.teeth && <span className="text-muted-foreground"> · teeth {item.teeth}</span>}
                  {item.discountAmount > 0 && (
                    <span className="text-muted-foreground"> · less {formatPKR(item.discountAmount)}</span>
                  )}
                </td>
                <td className="p-3 text-right">{item.itemType === 'discount' ? '' : item.quantity}</td>
                <td className="p-3 text-right">{item.itemType === 'discount' ? '' : formatPKR(item.unitPrice)}</td>
                <td className="p-3 text-right font-medium">{formatPKR(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t">
            <tr>
              <td colSpan={3} className="p-3 text-right text-muted-foreground">Subtotal</td>
              <td className="p-3 text-right">{formatPKR(invoice.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="p-3 text-right text-muted-foreground">Discount</td>
              <td className="p-3 text-right">− {formatPKR(invoice.discountTotal)}</td>
            </tr>
            <tr className="border-t font-semibold">
              <td colSpan={3} className="p-3 text-right">Total</td>
              <td className="p-3 text-right">{formatPKR(invoice.totalAmount)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="p-3 text-right text-muted-foreground">Paid</td>
              <td className="p-3 text-right">{formatPKR(invoice.paidAmount)}</td>
            </tr>
            <tr className={balance > 0 ? 'text-amber-700 dark:text-amber-500 font-semibold' : 'font-semibold'}>
              <td colSpan={3} className="p-3 text-right">Balance</td>
              <td className="p-3 text-right">{formatPKR(balance)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
        <CardContent>
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing received yet.</p>
          ) : (
            <ul className="divide-y">
              {data.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <span className={p.type === 'refund' ? 'text-destructive font-medium' : 'font-medium'}>
                      {humanize(p.type)}
                    </span>
                    <span className="text-muted-foreground">
                      {p.method ? ` · ${humanize(p.method)}` : ''} · {fmtDateTime(new Date(p.paymentDate))}
                    </span>
                  </div>
                  <span className={p.type === 'refund' ? 'text-destructive' : ''}>
                    {p.type === 'refund' ? '−' : ''}{formatPKR(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {open && (
          <Button onClick={() => { setPayment({ amount: String(balance), method: 'cash', splitExcess: false }); setPaying(true); }}>
            Record payment
          </Button>
        )}
        {open && (
          <Button variant="outline" disabled={busy} onClick={waive}>
            Waive invoice
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button asChild variant="ghost"><Link href="/billing">All invoices</Link></Button>
      </div>

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Record a payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="payAmount">Amount (Rs.)</Label>
              <Input id="payAmount" type="number" min={1} value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
              <p className="text-xs text-muted-foreground">Balance: {formatPKR(balance)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payMethod">Method</Label>
              <select id="payMethod" className={selectClass} value={payment.method}
                onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                {valuesOf(PAYMENT_METHOD).filter((m) => m !== 'adjustment').map((m) => (
                  <option key={m} value={m}>{humanize(m)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 rounded border-input"
                checked={payment.splitExcess}
                onChange={(e) => setPayment({ ...payment, splitExcess: e.target.checked })} />
              Keep any excess on account as credit
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPaying(false)}>Cancel</Button>
            <Button disabled={busy || !Number(payment.amount)} onClick={recordPayment}>
              {busy ? 'Recording…' : 'Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
