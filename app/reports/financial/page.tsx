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

interface FinancialReport {
  byDay: { day: string; collected: number; refunded: number; net: number }[];
  byMethod: { method: string | null; count: number; net: number }[];
  outstanding: { invoices: number; billed: number; paid: number; outstanding: number };
  byDentist: { dentistId: string; dentistName: string | null; procedures: number; revenue: number }[];
  byCategory: { category: string | null; procedures: number; revenue: number }[];
}

function FinancialReportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from') ?? toDateKey(addDays(clinicNow(), -30));
  const to = searchParams.get('to') ?? toDateKey(clinicNow());

  const [data, setData] = useState<FinancialReport | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get<FinancialReport>(`/api/reports/financial${qs({ from, to })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the report.');
    }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const setRange = (nextFrom: string, nextTo: string) =>
    router.push(`/reports/financial?from=${nextFrom}&to=${nextTo}`);

  const totalNet = data?.byDay.reduce((s, d) => s + Number(d.net), 0) ?? 0;
  const maxDay = Math.max(1, ...(data?.byDay.map((d) => Number(d.net)) ?? [1]));

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Collections are money in the door by payment date; production is work done by visit
            date, attributed to who did it.
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
          {[
            { label: '7d', days: 7 },
            { label: '30d', days: 30 },
            { label: '90d', days: 90 },
          ].map((preset) => (
            <Button key={preset.label} size="sm" variant="outline"
              onClick={() => setRange(toDateKey(addDays(clinicNow(), -preset.days)), toDateKey(clinicNow()))}>
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Collected (net)" value={formatPKR(totalNet)} />
            <Stat label="Outstanding" value={formatPKR(data.outstanding.outstanding)}
              hint={`${data.outstanding.invoices} open invoice(s)`} />
            <Stat label="Refunded" value={formatPKR(data.byDay.reduce((s, d) => s + Number(d.refunded), 0))} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Collections by day</CardTitle></CardHeader>
            <CardContent>
              {data.byDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments in this range.</p>
              ) : (
                <div className="space-y-1">
                  {data.byDay.map((d) => (
                    <div key={d.day} className="flex items-center gap-2 text-sm">
                      <span className="w-24 font-mono text-xs text-muted-foreground">{d.day}</span>
                      <div className="h-4 rounded-sm bg-primary/70"
                        style={{ width: `${Math.max(2, (Number(d.net) / maxDay) * 100)}%` }} />
                      <span className="text-xs">{formatPKR(d.net)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BreakdownCard title="By payment method"
              rows={data.byMethod.map((m) => ({ label: m.method ? humanize(m.method) : 'Unspecified', count: m.count, value: m.net }))} />
            <BreakdownCard title="Production by dentist"
              rows={data.byDentist.map((d) => ({ label: d.dentistName ?? 'Unknown', count: d.procedures, value: d.revenue }))} />
            <BreakdownCard title="Production by category"
              rows={data.byCategory.map((c) => ({ label: c.category ? humanize(c.category) : 'Uncategorised', count: c.procedures, value: c.revenue }))} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: { label: string; count: number; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.value)));
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this range.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.label} className="text-sm">
                <div className="flex justify-between">
                  <span>{row.label} <span className="text-muted-foreground">({row.count})</span></span>
                  <span className="font-medium">{formatPKR(row.value)}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary/70"
                    style={{ width: `${(Number(row.value) / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinancialReportPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <FinancialReportView />
    </Suspense>
  );
}
