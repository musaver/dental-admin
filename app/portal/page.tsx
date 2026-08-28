'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api-client';
import { fmtDate, fmtDateTime } from '@/lib/datetime';
import { formatPKR, invoiceBalance } from '@/lib/money';
import { humanize } from '@/lib/enums';

interface Me {
  name: string | null;
  patients: { id: string; mrn: string; firstName: string; lastName: string | null }[];
}
interface Appointment {
  id: string; startAt: string; type: string; status: string;
  dentistName: string | null; patientFirstName: string | null;
}
interface Plan {
  id: string; title: string; status: string; netAmount: number;
  proposedAt: string | null; acceptedAt: string | null; dentistName: string | null;
}
interface Invoice {
  id: string; invoiceNumber: string; issueDate: string;
  totalAmount: number; paidAmount: number; status: string;
}

export default function PortalHome() {
  const [me, setMe] = useState<Me | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState('');
  const [accepting, setAccepting] = useState<string | null>(null);

  const load = async () => {
    try {
      const [meRes, appts, planRows, invoiceRows] = await Promise.all([
        api.get<Me>('/api/portal/me'),
        api.get<Appointment[]>('/api/portal/appointments'),
        api.get<Plan[]>('/api/portal/treatment-plans'),
        api.get<Invoice[]>('/api/portal/invoices'),
      ]);
      setMe(meRes);
      setAppointments(appts);
      setPlans(planRows);
      setInvoices(invoiceRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your records.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  async function accept(planId: string) {
    setAccepting(planId);
    setError('');
    try {
      await api.post(`/api/portal/treatment-plans/${planId}/accept`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the plan.');
    } finally {
      setAccepting(null);
    }
  }

  if (error && !me) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!me) return <p className="text-muted-foreground">Loading…</p>;

  if (me.patients.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Your account is not linked to a patient record yet. Ask the clinic to send you an
          invitation, then open the link in it while signed in here.
        </CardContent>
      </Card>
    );
  }

  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.startAt).getTime() >= now).reverse();
  const proposed = plans.filter((p) => p.status === 'proposed');
  const owing = invoices.filter((i) => ['unpaid', 'partial'].includes(i.status));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {me.name ? `Hello, ${me.name}` : 'Your records'}
      </h1>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* A proposed plan is the thing most worth surfacing first. */}
      {proposed.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Awaiting your decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {proposed.map((plan) => (
              <div key={plan.id} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{plan.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {plan.dentistName ? `${plan.dentistName} · ` : ''}
                    {formatPKR(plan.netAmount)}
                  </div>
                </div>
                <Button size="sm" disabled={accepting === plan.id} onClick={() => accept(plan.id)}>
                  {accepting === plan.id ? 'Accepting…' : 'Accept this plan'}
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Questions about a plan? Call the clinic before accepting.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming appointments</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing booked. Call the clinic to arrange a visit.
            </p>
          ) : (
            <ul className="divide-y">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="font-medium">{fmtDateTime(new Date(a.startAt))}</div>
                    <div className="text-sm text-muted-foreground">
                      {humanize(a.type)}
                      {a.dentistName ? ` · ${a.dentistName}` : ''}
                      {me.patients.length > 1 && a.patientFirstName ? ` · for ${a.patientFirstName}` : ''}
                    </div>
                  </div>
                  <Badge variant="secondary">{humanize(a.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices.</p>
          ) : (
            <>
              <ul className="divide-y">
                {invoices.slice(0, 8).map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <span className="font-mono text-xs">{invoice.invoiceNumber}</span>
                      <span className="text-muted-foreground"> · {fmtDate(new Date(invoice.issueDate))}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span>{formatPKR(invoice.totalAmount)}</span>
                      <Badge variant="secondary">{humanize(invoice.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
              {owing.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Outstanding balance:{' '}
                  <span className="font-medium text-foreground">
                    {formatPKR(owing.reduce((sum, i) => sum + invoiceBalance(i), 0))}
                  </span>
                  {' '}— payable at the clinic. Online payment is not available yet.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
