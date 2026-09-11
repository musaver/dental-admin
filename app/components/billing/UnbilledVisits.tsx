'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { patientName } from '@/lib/patient-identity';
import type { Paginated } from '@/lib/pagination';

/**
 * The unbilled backlog: completed visits carrying work nobody has invoiced.
 *
 * The row's action raises the invoice rather than linking to the visit —
 * someone with billing_view but not clinical_view would hit a 404 on
 * /visits/{id}, and billing the visit is the actual job anyway.
 */
interface UnbilledRow {
  id: string;
  visitDate: string;
  patientId: string;
  mrn: string | null;
  firstName: string | null;
  lastName: string | null;
  dentistName: string | null;
  procedures: number;
  estimatedAmount: number;
}

export default function UnbilledVisits() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<UnbilledRow> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /** The visit currently being billed, so only its own button goes quiet. */
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<Paginated<UnbilledRow>>(`/api/visits/unbilled${qs({ page })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load unbilled visits.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const raise = async (row: UnbilledRow) => {
    setBusy(row.id);
    setError('');
    try {
      const result = await api.post<{ invoice: { id: string } }>('/api/invoices', {
        patientId: row.patientId,
        visitId: row.id,
      });
      router.push(`/billing/${result.invoice.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not raise the invoice.');
      // Two people work this list at once, so a row going stale under someone
      // is the normal case here rather than the exception. Reload so the row
      // disappears instead of sitting there offering an invoice again.
      if (err instanceof ApiError && err.code === 'NOTHING_TO_INVOICE') await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Visit</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Dentist</TableHead>
              <TableHead className="text-right">Procedures</TableHead>
              <TableHead className="text-right">Est.</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!loading && data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  Nothing is waiting to be billed.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              data?.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDate(new Date(row.visitDate))}
                  </TableCell>
                  <TableCell>
                    {row.firstName ? (
                      <Link href={`/patients/${row.patientId}`} className="hover:underline">
                        {patientName({ firstName: row.firstName, lastName: row.lastName })}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Unknown</span>
                    )}
                    {row.mrn && (
                      <div className="text-xs text-muted-foreground font-mono">{row.mrn}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.dentistName ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{row.procedures}</TableCell>
                  {/* Gross, before the patient's standing discount — which the
                      invoice adds as its own line. Hence "Est." */}
                  <TableCell className="text-right">{formatPKR(row.estimatedAmount)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" disabled={busy !== null} onClick={() => raise(row)}>
                      {busy === row.id ? 'Raising…' : 'Raise invoice'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      {data && data.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
