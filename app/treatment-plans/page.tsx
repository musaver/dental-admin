'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';
import type { Paginated } from '@/lib/pagination';

interface PlanRow {
  id: string;
  title: string;
  status: string;
  netAmount: number;
  proposedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  patientId: string;
  patientMrn: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  dentistName: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  proposed: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  accepted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  in_progress: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  completed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  cancelled: 'bg-neutral-100 text-neutral-500 line-through',
};

function PlansList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const [data, setData] = useState<Paginated<PlanRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<Paginated<PlanRow>>(`/api/treatment-plans${qs({ status, page })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load treatment plans.');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => { load(); }, [load]);

  const setParams = (next: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, String(v));
    }
    router.push(`/treatment-plans?${params.toString()}`);
  };

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Treatment plans</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Plans are created from a patient&rsquo;s page, where the chart is.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {['', 'draft', 'proposed', 'accepted', 'in_progress', 'completed'].map((s) => (
          <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'}
            onClick={() => setParams({ status: s, page: 1 })}>
            {s ? humanize(s) : 'All'}
          </Button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Dentist</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Proposed</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!loading && data?.rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">No plans yet.</TableCell></TableRow>
            )}
            {!loading && data?.rows.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <Link href={`/treatment-plans/${plan.id}`} className="font-medium hover:underline">
                    {plan.title}
                  </Link>
                </TableCell>
                <TableCell>
                  {plan.patientFirstName && (
                    <Link href={`/patients/${plan.patientId}`} className="hover:underline">
                      {patientName({ firstName: plan.patientFirstName, lastName: plan.patientLastName })}
                    </Link>
                  )}
                  {plan.patientMrn && (
                    <div className="font-mono text-xs text-muted-foreground">{plan.patientMrn}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{plan.dentistName ?? '—'}</TableCell>
                <TableCell className="text-right font-medium">{formatPKR(plan.netAmount)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {plan.proposedAt ? fmtDate(new Date(plan.proposedAt)) : '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={STATUS_STYLES[plan.status] ?? ''}>
                    {humanize(plan.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {data && data.pageCount > 1 && (
        <div className="mt-4 flex justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setParams({ page: data.page - 1 })}>Previous</Button>
          <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setParams({ page: data.page + 1 })}>Next</Button>
        </div>
      )}
    </div>
  );
}

export default function TreatmentPlansPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <PlansList />
    </Suspense>
  );
}
