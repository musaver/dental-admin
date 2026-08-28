'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { humanize } from '@/lib/enums';
import type { Paginated } from '@/lib/pagination';
import NewLeadDialog from '@/app/components/NewLeadDialog';

interface LeadRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  status: string;
  interestNote: string | null;
  nextFollowUpAt: string | null;
  convertedPatientId: string | null;
  assigneeName: string | null;
  procedureName: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  contacted: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
  follow_up: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  qualified: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  converted: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  lost: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900',
};

function LeadsList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const due = searchParams.get('due') === '1';
  const status = searchParams.get('status') ?? '';
  const search = searchParams.get('q') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const [input, setInput] = useState(search);
  const [data, setData] = useState<Paginated<LeadRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(
        await api.get<Paginated<LeadRow>>(
          `/api/leads${qs({ q: search, status, page, due: due ? 1 : null })}`
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load leads.');
    } finally {
      setLoading(false);
    }
  }, [search, status, page, due]);

  useEffect(() => {
    load();
  }, [load]);

  const setParams = (next: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') params.delete(k);
      else params.set(k, String(v));
    }
    router.push(`/leads?${params.toString()}`);
  };

  async function convert(lead: LeadRow, allowDuplicate = false) {
    setConverting(lead.id);
    setError('');
    try {
      const result = await api.post<{ patient: { id: string } }>(
        `/api/leads/${lead.id}/convert`,
        allowDuplicate ? { allowDuplicate: true } : {}
      );
      router.push(`/patients/${result.patient.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') {
        const candidates = (err.body.duplicates as { mrn: string }[]) ?? [];
        const proceed = confirm(
          `This may already be a patient (${candidates.map((c) => c.mrn).join(', ')}). ` +
            `Convert as a NEW patient anyway?`
        );
        if (proceed) return convert(lead, true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not convert this enquiry.');
      }
    } finally {
      setConverting(null);
    }
  }

  const now = Date.now();

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {data.total} {due ? 'due for follow-up' : 'enquiries'}
            </p>
          )}
        </div>
        <Button variant="success" onClick={() => setAdding(true)}>New enquiry</Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q: input, page: 1 });
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search name or phone"
            className="w-56"
          />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
        <Button size="sm" variant={due ? 'default' : 'outline'} onClick={() => setParams({ due: due ? null : 1, page: 1 })}>
          Follow-ups due
        </Button>
        {['', 'new', 'contacted', 'follow_up', 'converted', 'lost'].map((s) => (
          <Button
            key={s || 'all'}
            size="sm"
            variant={status === s ? 'default' : 'outline'}
            onClick={() => setParams({ status: s, page: 1 })}
          >
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
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Interested in</TableHead>
              <TableHead>Follow-up</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!loading && data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  {due ? 'No follow-ups due. Well done.' : 'No enquiries yet.'}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              data?.rows.map((lead) => {
                const followUp = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
                const overdue = followUp !== null && followUp.getTime() <= now &&
                  !['converted', 'lost'].includes(lead.status);
                return (
                  <TableRow key={lead.id} className={overdue ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                    <TableCell>
                      <span className="font-medium">{lead.name}</span>
                      {lead.assigneeName && (
                        <div className="text-xs text-muted-foreground">{lead.assigneeName}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{lead.phone}</TableCell>
                    <TableCell>{humanize(lead.source)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.procedureName ?? lead.interestNote ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {followUp ? (
                        <span className={overdue ? 'font-medium text-amber-700 dark:text-amber-500' : ''}>
                          {fmtDate(followUp)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_STYLES[lead.status] ?? ''}>
                        {humanize(lead.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {lead.convertedPatientId ? (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/patients/${lead.convertedPatientId}`}>Open patient</Link>
                        </Button>
                      ) : lead.status !== 'lost' ? (
                        <Button
                          size="sm"
                          disabled={converting === lead.id}
                          onClick={() => convert(lead)}
                        >
                          {converting === lead.id ? 'Converting…' : 'Convert to patient'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>

      {data && data.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {data.page} of {data.pageCount}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setParams({ page: data.page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={data.page >= data.pageCount} onClick={() => setParams({ page: data.page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {adding && (
        <NewLeadDialog
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <LeadsList />
    </Suspense>
  );
}
