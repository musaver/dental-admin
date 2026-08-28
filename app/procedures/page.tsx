'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { api, ApiError } from '@/lib/api-client';
import { formatPKR } from '@/lib/money';
import { humanize } from '@/lib/enums';

interface Procedure {
  id: string; code: string | null; name: string; category: string;
  defaultPrice: number; durationMinutes: number | null;
  isPerTooth: boolean | null; defaultRecallMonths: number | null; isActive: boolean | null;
}

/** The price list — what everything costs and how long it takes. */
export default function ProceduresPage() {
  const [rows, setRows] = useState<Procedure[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Procedure[]>('/api/procedures?all=1'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the price list.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = [...new Set(rows.map((r) => r.category))];

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Procedures</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {rows.length} procedures across {categories.length} categories. Prices are whole rupees;
          per-tooth procedures multiply by the teeth treated.
        </p>
      </div>

      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Recall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
            {!loading && rows.map((p) => (
              <TableRow key={p.id} className={p.isActive === false ? 'opacity-50' : ''}>
                <TableCell className="font-mono text-xs">{p.code ?? '—'}</TableCell>
                <TableCell className="font-medium">
                  {p.name}
                  {p.isPerTooth && <Badge variant="secondary" className="ml-2 text-[10px]">per tooth</Badge>}
                </TableCell>
                <TableCell>{humanize(p.category)}</TableCell>
                <TableCell className="text-right">{formatPKR(p.defaultPrice)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{p.durationMinutes ?? 30}m</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.defaultRecallMonths ? `${p.defaultRecallMonths} months` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
