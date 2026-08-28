'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDateTime } from '@/lib/datetime';
import { AUDIT_ACTION, humanize, valuesOf } from '@/lib/enums';

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  patientId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  update: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  delete: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  view: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  login: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
  export: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(
    async (cursor?: string | null) => {
      setLoading(true);
      setError('');
      try {
        const data = await api.get<{ rows: AuditRow[]; nextCursor: string | null }>(
          `/api/audit${qs({ action, cursor: cursor ?? null })}`
        );
        setRows((current) => (cursor ? [...current, ...data.rows] : data.rows));
        setNextCursor(data.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the audit trail.');
      } finally {
        setLoading(false);
      }
    },
    [action]
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Audit trail</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Who did what, when. This record is never purged, and opening it is itself recorded.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Button size="sm" variant={action === '' ? 'default' : 'outline'} onClick={() => setAction('')}>
          All
        </Button>
        {valuesOf(AUDIT_ACTION).map((a) => (
          <Button
            key={a}
            size="sm"
            variant={action === a ? 'default' : 'outline'}
            onClick={() => setAction(a)}
          >
            {humanize(a)}
          </Button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="py-0 divide-y">
        {loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Nothing recorded yet.</div>
        )}

        {rows.map((row) => {
          const isOpen = expanded === row.id;
          const hasDiff = row.before || row.after;
          return (
            <div key={row.id} className="px-4 py-2.5">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-2 text-left text-sm"
                onClick={() => setExpanded(isOpen ? null : row.id)}
                disabled={!hasDiff}
              >
                <Badge variant="secondary" className={ACTION_STYLES[row.action] ?? ''}>
                  {humanize(row.action)}
                </Badge>
                <span className="font-medium">{humanize(row.entityType)}</span>
                <span className="text-muted-foreground">{row.actorEmail}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmtDateTime(new Date(row.createdAt))}
                  {row.ipAddress ? ` · ${row.ipAddress}` : ''}
                </span>
              </button>

              {isOpen && hasDiff && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
                  <DiffPane title="Before" value={row.before} />
                  <DiffPane title="After" value={row.after} />
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {nextCursor && (
        <div className="mt-4">
          <Button variant="outline" disabled={loading} onClick={() => load(nextCursor)}>
            {loading ? 'Loading…' : 'Load older entries'}
          </Button>
        </div>
      )}
    </div>
  );
}

function DiffPane({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <div className="rounded-md border bg-muted/40 p-2">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      {value ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono">
          {JSON.stringify(value, null, 1)}
        </pre>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}
