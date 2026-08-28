'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { addDays, clinicNow, fmtDateTime, toDateKey } from '@/lib/datetime';
import { formatPKR, signedAmount } from '@/lib/money';
import { humanize } from '@/lib/enums';

interface PaymentRow {
  id: string; patientId: string; invoiceId: string | null;
  amount: number; type: string; method: string | null;
  paymentDate: string; notes: string | null;
}

/** The takings: every payment, deposit and refund in a date range. */
export default function PaymentsPage() {
  const [from, setFrom] = useState(toDateKey(addDays(clinicNow(), -7)));
  const [to, setTo] = useState(toDateKey(clinicNow()));
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(
        await api.get<PaymentRow[]>(
          `/api/payments${qs({ from: `${from}T00:00:00`, to: `${to}T23:59:59` })}`
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the takings.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const net = rows.reduce((sum, p) => sum + signedAmount(p), 0);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} entries · net {formatPKR(net)}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={load}>Apply</Button>
        </div>
      </div>

      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Against</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nothing in this range.</TableCell></TableRow>
            )}
            {!loading && rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-sm">{fmtDateTime(new Date(p.paymentDate))}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={p.type === 'refund' ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' : ''}>
                    {humanize(p.type)}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{p.method ? humanize(p.method) : '—'}</TableCell>
                <TableCell className="text-sm">
                  {p.invoiceId ? (
                    <Link href={`/billing/${p.invoiceId}`} className="hover:underline">Invoice</Link>
                  ) : (
                    <span className="text-muted-foreground">On account</span>
                  )}
                </TableCell>
                <TableCell className={`text-right font-medium ${p.type === 'refund' ? 'text-destructive' : ''}`}>
                  {p.type === 'refund' ? '−' : ''}{formatPKR(p.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
