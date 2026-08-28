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
import { fmtDateTime } from '@/lib/datetime';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';

interface CommRow {
  id: string; channel: string; direction: string; subject: string | null;
  status: string; templateKey: string | null; createdAt: string;
  patientId: string | null; patientFirstName: string | null; patientLastName: string | null;
  patientPhone: string | null; leadId: string | null; leadName: string | null; leadPhone: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  delivered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  logged: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  failed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  bounced: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  skipped: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

/**
 * The message log. The "Needs a call" filter is the point: a skipped row is
 * someone the automatic reminder could not reach — no email on file — and
 * their phone number is right there.
 */
export default function CommunicationsPage() {
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<CommRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await api.get<CommRow[]>(`/api/communications${qs({ status })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Everything the clinic has sent. Only email sends automatically — a
          &ldquo;skipped&rdquo; row is a patient with no email who needs a phone call instead.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={status === '' ? 'default' : 'outline'} onClick={() => setStatus('')}>All</Button>
        <Button size="sm" variant={status === 'skipped' ? 'default' : 'outline'} onClick={() => setStatus('skipped')}>
          Needs a call
        </Button>
        <Button size="sm" variant={status === 'failed' ? 'default' : 'outline'} onClick={() => setStatus('failed')}>Failed</Button>
        <Button size="sm" variant={status === 'sent' ? 'default' : 'outline'} onClick={() => setStatus('sent')}>Sent</Button>
      </div>

      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nothing here.</TableCell></TableRow>
            )}
            {!loading && rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-sm">{fmtDateTime(new Date(row.createdAt))}</TableCell>
                <TableCell>
                  {row.patientId ? (
                    <Link href={`/patients/${row.patientId}`} className="font-medium hover:underline">
                      {patientName({ firstName: row.patientFirstName ?? 'Patient', lastName: row.patientLastName })}
                    </Link>
                  ) : row.leadName ? (
                    <span className="font-medium">{row.leadName} <span className="text-xs text-muted-foreground">(enquiry)</span></span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{row.patientPhone ?? row.leadPhone ?? '—'}</TableCell>
                <TableCell className="text-sm">
                  {row.subject ?? (row.templateKey ? humanize(row.templateKey) : humanize(row.channel))}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={STATUS_STYLES[row.status] ?? ''}>
                    {humanize(row.status)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
