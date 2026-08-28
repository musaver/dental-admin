'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { humanize, DISCOUNT_TYPE, valuesOf } from '@/lib/enums';
import { parseTeeth } from '@/lib/odontogram';
import { patientName } from '@/lib/patient-identity';

interface PlanData {
  plan: {
    id: string; title: string; status: string; notes: string | null;
    totalAmount: number; discountTotal: number; netAmount: number;
    proposedAt: string | null; acceptedAt: string | null; acceptedNote: string | null;
    cancelReason: string | null; patientId: string;
  };
  items: ItemRow[];
  patient: { id: string; mrn: string; firstName: string; lastName: string | null; defaultDiscountPercent: number } | null;
  dentist: { id: string; name: string | null } | null;
}
interface ItemRow {
  id: string; procedureName: string | null; procedureCode: string | null;
  isPerTooth: boolean | null; teeth: string | null; unitPrice: number; quantity: number;
  discountType: string | null; discountValue: number | null; netAmount: number; status: string;
}
interface Procedure { id: string; name: string; defaultPrice: number; isPerTooth: boolean | null }

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

/**
 * The plan editor. Items can be added and priced while the plan is a quote;
 * once the patient accepts, the numbers lock (the server refuses with
 * PRICING_LOCKED) and only progress moves.
 */
export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<PlanData | null>(null);
  const [catalogue, setCatalogue] = useState<Procedure[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [newItem, setNewItem] = useState({
    procedureId: '', teeth: '', discountType: '', discountValue: '',
  });

  const load = useCallback(async () => {
    try {
      setData(await api.get<PlanData>(`/api/treatment-plans/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the plan.');
    }
  }, [id]);

  useEffect(() => {
    load();
    api.get<Procedure[]>('/api/procedures').then(setCatalogue).catch(() => setCatalogue([]));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <div className="p-4"><div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div></div>;
  }
  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const { plan } = data;
  const editable = plan.status === 'draft' || plan.status === 'proposed';

  /** The legal next steps from this status. The server enforces; we offer. */
  const transitions: { to: string; label: string; needsReason?: boolean; variant?: 'destructive' | 'success' }[] =
    plan.status === 'draft'
      ? [{ to: 'proposed', label: 'Propose to patient' }]
      : plan.status === 'proposed'
        ? [
            { to: 'accepted', label: 'Patient accepted', variant: 'success' },
            { to: 'rejected', label: 'Patient declined', needsReason: true, variant: 'destructive' },
            { to: 'draft', label: 'Back to draft' },
          ]
        : plan.status === 'accepted'
          ? [{ to: 'in_progress', label: 'Start treatment' }]
          : plan.status === 'in_progress'
            ? [{ to: 'completed', label: 'Complete plan', variant: 'success' }]
            : [];

  async function setStatus(to: string, needsReason?: boolean) {
    let reason: string | null = null;
    if (needsReason) {
      reason = prompt('Why? (recorded on the plan)');
      if (!reason?.trim()) return;
    }
    await run(() => api.post(`/api/treatment-plans/${id}/status`, { status: to, reason }));
  }

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{plan.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.patient && (
              <Link href={`/patients/${data.patient.id}`} className="hover:underline">
                {patientName(data.patient)} ({data.patient.mrn})
              </Link>
            )}
            {data.dentist?.name ? <> · {data.dentist.name}</> : null}
            {plan.proposedAt ? <> · proposed {fmtDate(new Date(plan.proposedAt))}</> : null}
            {plan.acceptedAt ? <> · accepted {fmtDate(new Date(plan.acceptedAt))}</> : null}
          </p>
        </div>
        <Badge variant="secondary">{humanize(plan.status)}</Badge>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {plan.cancelReason && (
        <p className="text-sm text-destructive">Reason: {plan.cancelReason}</p>
      )}
      {plan.acceptedNote && (
        <p className="text-sm text-muted-foreground">{plan.acceptedNote}</p>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing on this plan yet.</p>
          )}
          <ul className="divide-y">
            {data.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className={`font-medium ${item.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}`}>
                    {item.procedureName ?? 'Procedure'}
                  </span>
                  <span className="text-muted-foreground">
                    {item.teeth ? ` · teeth ${item.teeth}` : ''}
                    {item.quantity > 1 ? ` · ${item.quantity} × ${formatPKR(item.unitPrice)}` : ''}
                    {item.discountValue
                      ? ` · less ${item.discountType === 'percentage' ? `${item.discountValue}%` : formatPKR(item.discountValue)}`
                      : ''}
                  </span>
                  <Badge variant="secondary" className="ml-2 text-[10px]">{humanize(item.status)}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{formatPKR(item.netAmount)}</span>
                  {editable && (
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => run(() => api.del(`/api/treatment-plans/${id}/items/${item.id}`))}>
                      Remove
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {editable && (
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] items-end border-t pt-3">
              <div className="space-y-1">
                <Label>Procedure</Label>
                <select className={selectClass} value={newItem.procedureId}
                  onChange={(e) => setNewItem({ ...newItem, procedureId: e.target.value })}>
                  <option value="">Choose…</option>
                  {catalogue.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatPKR(p.defaultPrice)}{p.isPerTooth ? ' /tooth' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Teeth</Label>
                <Input placeholder="16,17" value={newItem.teeth}
                  onChange={(e) => setNewItem({ ...newItem, teeth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Discount</Label>
                <select className={selectClass} value={newItem.discountType}
                  onChange={(e) => setNewItem({ ...newItem, discountType: e.target.value })}>
                  <option value="">None</option>
                  {valuesOf(DISCOUNT_TYPE).map((t) => (
                    <option key={t} value={t}>{humanize(t)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{newItem.discountType === 'percentage' ? '%' : 'Rs.'}</Label>
                <Input type="number" min={0} disabled={!newItem.discountType}
                  value={newItem.discountValue}
                  onChange={(e) => setNewItem({ ...newItem, discountValue: e.target.value })} />
              </div>
              <Button
                disabled={busy || !newItem.procedureId}
                onClick={() =>
                  run(async () => {
                    await api.post(`/api/treatment-plans/${id}/items`, {
                      procedureId: newItem.procedureId,
                      teeth: parseTeeth(newItem.teeth.split(/[\s,]+/).join(',')),
                      discountType: newItem.discountType || null,
                      discountValue: newItem.discountValue ? Number(newItem.discountValue) : null,
                    });
                    setNewItem({ procedureId: '', teeth: '', discountType: '', discountValue: '' });
                  })
                }
              >
                Add
              </Button>
            </div>
          )}
          {!editable && (
            <p className="text-xs text-muted-foreground border-t pt-3">
              Pricing is locked{plan.status === 'accepted' || plan.status === 'in_progress' || plan.status === 'completed'
                ? ' because the patient accepted this quote. Additional work belongs on a new plan.'
                : '.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 grid gap-1.5 sm:grid-cols-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total</div>
            <div className="text-lg font-medium">{formatPKR(plan.totalAmount)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Discount</div>
            <div className="text-lg font-medium">− {formatPKR(plan.discountTotal)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Net</div>
            <div className="text-lg font-semibold">{formatPKR(plan.netAmount)}</div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <Button key={t.to} variant={t.variant ?? 'default'} disabled={busy}
            onClick={() => setStatus(t.to, t.needsReason)}>
            {t.label}
          </Button>
        ))}
        {(plan.status === 'accepted' || plan.status === 'in_progress' || plan.status === 'completed') && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api.post<{ invoice: { id: string } }>('/api/invoices', {
                  patientId: plan.patientId,
                  treatmentPlanId: plan.id,
                });
                router.push(`/billing/${result.invoice.id}`);
              })
            }
          >
            Invoice this plan
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/treatment-plans">All plans</Link>
        </Button>
      </div>
    </div>
  );
}
