'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, qs, ApiError } from '@/lib/api-client';
import { addDays, clinicNow, toDateKey } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { humanize } from '@/lib/enums';

interface ClinicalReport {
  appointments: { total: number; completed: number; cancelled: number; noShow: number; noShowRate: number };
  acceptance: {
    proposed: number; accepted: number; proposedValue: number; acceptedValue: number;
    rateByCount: number; rateByValue: number;
  };
  patients: { registered: number };
  leads: { source: string; total: number; converted: number; lost: number; conversionRate: number }[];
  recalls: { due: number; booked: number; completed: number; overdue: number };
}

function ClinicalReportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? toDateKey(addDays(clinicNow(), -30));
  const to = searchParams.get('to') ?? toDateKey(clinicNow());

  const [data, setData] = useState<ClinicalReport | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get<ClinicalReport>(`/api/reports/clinical${qs({ from, to })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the report.');
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const setRange = (nextFrom: string, nextTo: string) =>
    router.push(`/reports/clinical?from=${nextFrom}&to=${nextTo}`);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clinical</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            No-show rate counts only appointments that reached their day —
            completed, missed or cancelled.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setRange(e.target.value, to)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setRange(from, e.target.value)} />
          </div>
          {[30, 90].map((days) => (
            <Button key={days} size="sm" variant="outline"
              onClick={() => setRange(toDateKey(addDays(clinicNow(), -days)), toDateKey(clinicNow()))}>
              {days}d
            </Button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Appointments" value={String(data.appointments.total)}
              hint={`${data.appointments.completed} completed`} />
            <Stat label="No-show rate" value={`${data.appointments.noShowRate}%`}
              hint={`${data.appointments.noShow} missed · ${data.appointments.cancelled} cancelled`}
              warn={data.appointments.noShowRate > 10} />
            <Stat label="New patients" value={String(data.patients.registered)} />
            <Stat label="Recalls overdue" value={String(data.recalls.overdue)}
              hint={`${data.recalls.booked} booked · ${data.recalls.completed} completed`}
              warn={data.recalls.overdue > 0} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Treatment acceptance</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">By count</div>
                <div className="text-2xl font-semibold">{data.acceptance.rateByCount}%</div>
                <div className="text-xs text-muted-foreground">
                  {data.acceptance.accepted} of {data.acceptance.proposed} plans proposed
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">By value</div>
                <div className="text-2xl font-semibold">{data.acceptance.rateByValue}%</div>
                <div className="text-xs text-muted-foreground">
                  {formatPKR(data.acceptance.acceptedValue)} of {formatPKR(data.acceptance.proposedValue)} quoted
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Where enquiries come from</CardTitle></CardHeader>
            <CardContent>
              {data.leads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No enquiries in this range.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 font-medium">Source</th>
                      <th className="py-2 font-medium text-right">Enquiries</th>
                      <th className="py-2 font-medium text-right">Converted</th>
                      <th className="py-2 font-medium text-right">Lost</th>
                      <th className="py-2 font-medium text-right">Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.leads.map((row) => (
                      <tr key={row.source}>
                        <td className="py-2">{humanize(row.source)}</td>
                        <td className="py-2 text-right">{row.total}</td>
                        <td className="py-2 text-right">{row.converted}</td>
                        <td className="py-2 text-right text-muted-foreground">{row.lost}</td>
                        <td className="py-2 text-right font-medium">{row.conversionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${warn ? 'text-amber-600 dark:text-amber-500' : ''}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function ClinicalReportPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <ClinicalReportView />
    </Suspense>
  );
}
