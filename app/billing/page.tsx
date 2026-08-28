'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { formatPKR, invoiceBalance } from '@/lib/money';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';
import type { Paginated } from '@/lib/pagination';

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: number;
  paidAmount: number;
  status: string;
  patientId: string;
  patientMrn: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  unpaid: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  partial: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  waived: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  refunded: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  cancelled: 'bg-neutral-100 text-neutral-500 line-through',
};

function BillingList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const [data, setData] = useState<Paginated<InvoiceRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<Paginated<InvoiceRow>>(`/api/invoices${qs({ status, page })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load invoices.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const setParams = (next: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, String(v));
    }
    router.push(`/billing?${params.toString()}`);
  };

  const outstanding = (data?.rows ?? [])
    .filter((i) => ['unpaid', 'partial'].includes(i.status))
    .reduce((sum, i) => sum + invoiceBalance(i), 0);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {data.total} invoice{data.total === 1 ? '' : 's'}
              {outstanding > 0 && ` · ${formatPKR(outstanding)} outstanding on this page`}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { value: '', label: 'All' },
          { value: 'unpaid,partial', label: 'Outstanding' },
          { value: 'paid', label: 'Paid' },
          { value: 'waived', label: 'Waived' },
          { value: 'refunded', label: 'Refunded' },
        ].map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={status === option.value ? 'default' : 'outline'}
            onClick={() => setParams({ status: option.value, page: 1 })}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}

            {!loading && data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              data?.rows.map((invoice) => {
                const balance = invoiceBalance(invoice);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/billing/${invoice.id}`} className="hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {invoice.patientFirstName ? (
                        <Link href={`/patients/${invoice.patientId}`} className="hover:underline">
                          {patientName({
                            firstName: invoice.patientFirstName,
                            lastName: invoice.patientLastName,
                          })}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                      {invoice.patientMrn && (
                        <div className="text-xs text-muted-foreground font-mono">{invoice.patientMrn}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fmtDate(new Date(invoice.issueDate))}
                    </TableCell>
                    <TableCell className="text-right">{formatPKR(invoice.totalAmount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatPKR(invoice.paidAmount)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${balance > 0 ? 'text-amber-600 dark:text-amber-500' : ''}`}
                    >
                      {formatPKR(balance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLES[invoice.status] ?? ''}>
                        {humanize(invoice.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>

      {data && data.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setParams({ page: data.page - 1 })}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setParams({ page: data.page + 1 })}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <BillingList />
    </Suspense>
  );
}
