'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, qs, ApiError } from '@/lib/api-client';
import { addDays, clinicNow, fmtTime, toDateKey } from '@/lib/datetime';
import { waitingMinutes, waitSeverity } from '@/lib/appointments';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';

interface QueueRow {
  id: string;
  startAt: string;
  status: string;
  type: string;
  checkedInAt: string | null;
  dentistId: string;
  dentistName: string | null;
  patientId: string;
  patientFirstName: string;
  patientLastName: string | null;
  patientHasAlerts: boolean;
}

/**
 * The front desk's live view of today: who is booked, who is sitting in the
 * waiting room and for how long, who is in the chair.
 *
 * Polls every 30 seconds — there is no websocket layer in this stack — and
 * pauses while the tab is hidden so a forgotten browser window does not hammer
 * the database all day.
 */
const POLL_MS = 30_000;

export default function QueuePage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [now, setNow] = useState(clinicNow());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const today = toDateKey(clinicNow());
      const data = await api.get<QueueRow[]>(
        `/api/appointments${qs({
          from: `${today}T00:00:00`,
          to: `${toDateKey(addDays(clinicNow(), 1))}T00:00:00`,
        })}`
      );
      setRows(data);
      setNow(clinicNow());
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function setStatus(id: string, status: string) {
    setBusy(id);
    setError('');
    try {
      await api.post(`/api/appointments/${id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the appointment.');
    } finally {
      setBusy(null);
    }
  }

  const expected = rows
    .filter((r) => ['scheduled', 'confirmed'].includes(r.status))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const waiting = rows
    .filter((r) => r.status === 'checked_in')
    .sort((a, b) => (a.checkedInAt ?? '').localeCompare(b.checkedInAt ?? ''));
  const inChair = rows.filter((r) => r.status === 'in_progress');
  const done = rows.filter((r) => ['completed', 'no_show', 'cancelled'].includes(r.status));

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Front desk</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Today, live — refreshes every {POLL_MS / 1000} seconds.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Lane title={`Expected (${expected.length})`}>
          {expected.map((row) => (
            <QueueCard key={row.id} row={row} now={now}>
              <Button size="sm" disabled={busy === row.id} onClick={() => setStatus(row.id, 'checked_in')}>
                Check in
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === row.id} onClick={() => setStatus(row.id, 'no_show')}>
                No-show
              </Button>
            </QueueCard>
          ))}
          {expected.length === 0 && <Empty>Nobody else expected today.</Empty>}
        </Lane>

        <Lane title={`Waiting (${waiting.length})`} highlight={waiting.length > 0}>
          {waiting.map((row) => {
            const minutes = waitingMinutes(row.checkedInAt ? new Date(row.checkedInAt) : null, now);
            const severity = waitSeverity(minutes);
            return (
              <QueueCard key={row.id} row={row} now={now}
                badge={
                  minutes !== null ? (
                    <span className={
                      severity === 'urgent' ? 'font-semibold text-red-600 dark:text-red-500'
                      : severity === 'warn' ? 'font-medium text-amber-600 dark:text-amber-500'
                      : 'text-muted-foreground'
                    }>
                      waiting {minutes}m
                    </span>
                  ) : null
                }>
                <Button asChild size="sm" variant="success">
                  <Link href={`/schedule/${row.id}`}>Start visit</Link>
                </Button>
              </QueueCard>
            );
          })}
          {waiting.length === 0 && <Empty>The waiting room is clear.</Empty>}
        </Lane>

        <Lane title={`In the chair (${inChair.length}) · finished (${done.length})`}>
          {inChair.map((row) => (
            <QueueCard key={row.id} row={row} now={now}>
              <Button size="sm" disabled={busy === row.id} onClick={() => setStatus(row.id, 'completed')}>
                Complete
              </Button>
            </QueueCard>
          ))}
          {done.map((row) => (
            <QueueCard key={row.id} row={row} now={now} muted />
          ))}
          {inChair.length + done.length === 0 && <Empty>Nothing yet today.</Empty>}
        </Lane>
      </div>
    </div>
  );
}

function Lane({ title, highlight, children }: { title: string; highlight?: boolean; children: React.ReactNode }) {
  return (
    <Card className={highlight ? 'border-amber-400/60' : ''}>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function QueueCard({
  row, now, badge, muted, children,
}: {
  row: QueueRow; now: Date; badge?: React.ReactNode; muted?: boolean; children?: React.ReactNode;
}) {
  void now;
  return (
    <div className={`rounded-md border p-2.5 ${muted ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <div>
          <Link href={`/schedule/${row.id}`} className="font-medium hover:underline">
            {patientName({ firstName: row.patientFirstName, lastName: row.patientLastName })}
          </Link>
          {row.patientHasAlerts && (
            <span className="ml-1.5 text-destructive" title="Medical alert">●</span>
          )}
          <div className="text-xs text-muted-foreground">
            {fmtTime(new Date(row.startAt))} · {humanize(row.type)}
            {row.dentistName ? ` · ${row.dentistName}` : ''}
            {muted ? ` · ${humanize(row.status)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5">{badge}{children}</div>
      </div>
    </div>
  );
}
