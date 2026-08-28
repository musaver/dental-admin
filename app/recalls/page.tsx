'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';

interface RecallRow {
  id: string;
  recallType: string;
  dueDate: string;
  overdue: boolean;
  notes: string | null;
  patientId: string;
  patientMrn: string | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
}

/**
 * The recall worklist: patients whose next visit has come due. Each row is a
 * phone call — the number is right there — and the outcome is one click:
 * booked, contacted, snoozed, or dismissed.
 */
export default function RecallsPage() {
  const [rows, setRows] = useState<RecallRow[]>([]);
  const [horizon, setHorizon] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api.get<RecallRow[]>(`/api/recalls${qs({ withinDays: horizon })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the worklist.');
    } finally {
      setLoading(false);
    }
  }, [horizon]);

  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, patch: Record<string, unknown>) {
    setBusy(id);
    setError('');
    try {
      await api.patch(`/api/recalls/${id}`, patch);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the recall.');
    } finally {
      setBusy(null);
    }
  }

  const overdueCount = rows.filter((r) => r.overdue).length;

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recalls</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length} due within {horizon} days
            {overdueCount > 0 && (
              <span className="text-amber-600 dark:text-amber-500"> · {overdueCount} overdue</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((days) => (
            <Button
              key={days}
              size="sm"
              variant={horizon === days ? 'default' : 'outline'}
              onClick={() => setHorizon(days)}
            >
              {days} days
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Due</TableHead>
              <TableHead>Patient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Nothing due. The list fills as completed visits generate recalls.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              rows.map((recall) => (
                <TableRow key={recall.id} className={recall.overdue ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                  <TableCell>
                    <span className={recall.overdue ? 'font-medium text-amber-700 dark:text-amber-500' : ''}>
                      {fmtDate(new Date(recall.dueDate))}
                    </span>
                    {recall.overdue && <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Overdue</Badge>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/patients/${recall.patientId}`} className="font-medium hover:underline">
                      {patientName({
                        firstName: recall.patientFirstName ?? 'Patient',
                        lastName: recall.patientLastName,
                      })}
                    </Link>
                    {recall.patientMrn && (
                      <div className="font-mono text-xs text-muted-foreground">{recall.patientMrn}</div>
                    )}
                  </TableCell>
                  <TableCell>{humanize(recall.recallType)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {recall.patientPhone}
                    {!recall.patientEmail && (
                      <div className="text-muted-foreground font-sans" title="No email on file — reminders cannot reach them automatically">
                        phone only
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/schedule?patientId=${recall.patientId}&recallId=${recall.id}`}>Book</Link>
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === recall.id}
                        onClick={() => update(recall.id, { status: 'contacted' })}>
                        Contacted
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === recall.id}
                        onClick={() => update(recall.id, { snoozeMonths: 3 })}>
                        Snooze 3m
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === recall.id}
                        onClick={() => update(recall.id, { status: 'cancelled' })}>
                        Dismiss
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
