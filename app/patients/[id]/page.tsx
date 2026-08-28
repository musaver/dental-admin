'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api-client';
import { ageFrom, fmtDate, fmtDateTime } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { patientName } from '@/lib/patient-identity';
import { humanize } from '@/lib/enums';
import Odontogram from '@/app/components/Odontogram';

/**
 * The patient 360.
 *
 * Everything a dentist needs before an appointment on one screen: alerts,
 * balance, the chart, history, plans, appointments, files and money — without
 * navigating between unrelated sections.
 *
 * Fed by a single aggregate endpoint rather than one fetch per panel, because
 * each round trip runs from Vercel to a database in another region.
 */

interface Summary {
  patient: Record<string, string | number | boolean | null>;
  permissions: Record<string, boolean>;
  alerts: Condition[];
  conditions: Condition[];
  chart: ToothCondition[];
  visits: VisitRow[];
  treatmentPlans: PlanRow[];
  appointments: { upcoming: AppointmentRow[]; past: AppointmentRow[] };
  appointmentStats: { total: number; completed: number; noShow: number; cancelled: number };
  billing: BillingSummary | null;
  files: FileRow[];
  recalls: RecallRow[];
}

interface Condition {
  id: string; conditionType: string; name: string; severity: string | null;
  isAlert: boolean; notes: string | null; status: string;
}
interface ToothCondition {
  id: string; toothNumber: string; surfaces: string | null;
  conditionType: string; status: string; notes: string | null;
}
interface VisitRow {
  id: string; visitDate: string; status: string;
  chiefComplaint: string | null; dentistName: string | null;
}
interface PlanRow {
  id: string; title: string; status: string; netAmount: number;
  proposedAt: string | null; acceptedAt: string | null;
}
interface AppointmentRow {
  id: string; startAt: string; endAt?: string; type: string;
  status: string; dentistName?: string | null;
}
interface BillingSummary {
  billed: number; paid: number; outstanding: number;
  unallocatedCredit: number; netBalance: number; openInvoices: number;
}
interface FileRow {
  id: string; fileType: string; title: string | null; storageKey: string;
  mimeType: string; toothNumber: string | null; photoStage: string | null;
  pairId: string | null; createdAt: string;
}
interface RecallRow {
  id: string; recallType: string; dueDate: string; status: string;
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get<Summary>(`/api/patients/${id}/summary`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this patient.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
        <Button asChild variant="secondary" className="mt-4">
          <Link href="/patients">Back to patients</Link>
        </Button>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const p = data.patient;
  const dob = p.dateOfBirth ? new Date(String(p.dateOfBirth)) : null;
  const age = ageFrom(dob);
  const can = data.permissions;

  return (
    <div className="p-4 space-y-4">
      {/* Alerts come first and are unmissable — this is the point of the page. */}
      {data.alerts.length > 0 && (
        <div
          role="alert"
          className="rounded-md border-2 border-destructive bg-destructive/10 px-4 py-3"
        >
          <div className="font-semibold text-destructive mb-1">
            Medical alert{data.alerts.length > 1 ? 's' : ''}
          </div>
          <ul className="space-y-0.5 text-sm">
            {data.alerts.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">
                  {' '}· {humanize(a.conditionType)}
                  {a.severity ? ` · ${humanize(a.severity)}` : ''}
                </span>
                {a.notes && <span className="text-muted-foreground"> — {a.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">
              {patientName({
                firstName: String(p.firstName),
                lastName: p.lastName as string | null,
              })}
            </h1>
            <Badge variant="secondary" className="font-mono">{String(p.mrn)}</Badge>
            {p.status !== 'active' && <Badge variant="outline">{humanize(String(p.status))}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {[
              age !== null ? `${age} years` : null,
              p.gender ? humanize(String(p.gender)) : null,
              dob ? fmtDate(dob) : null,
              String(p.phone),
              p.bloodGroup ? `Blood group ${p.bloodGroup}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/patients/${id}/edit`}>Edit</Link>
          </Button>
          {can.appointments && (
            <Button asChild size="sm">
              <Link href={`/schedule?patientId=${id}`}>Book appointment</Link>
            </Button>
          )}
        </div>
      </div>

      {/* At-a-glance figures */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {can.billing && data.billing && (
          <Stat
            label="Balance"
            value={formatPKR(data.billing.netBalance)}
            tone={data.billing.netBalance > 0 ? 'warn' : 'ok'}
            hint={
              data.billing.unallocatedCredit > 0
                ? `Includes ${formatPKR(data.billing.unallocatedCredit)} credit on account`
                : `${data.billing.openInvoices} open invoice(s)`
            }
          />
        )}
        {can.appointments && (
          <Stat
            label="Appointments"
            value={String(data.appointmentStats.completed)}
            hint={`${data.appointmentStats.total} booked in total`}
          />
        )}
        {can.appointments && (
          <Stat
            label="No-shows"
            value={String(data.appointmentStats.noShow)}
            tone={data.appointmentStats.noShow > 0 ? 'warn' : 'ok'}
            hint={`${data.appointmentStats.cancelled} cancelled`}
          />
        )}
        <Stat
          label="Recalls due"
          value={String(data.recalls.length)}
          hint={data.recalls[0] ? `Next ${fmtDate(new Date(data.recalls[0].dueDate))}` : 'None pending'}
        />
      </div>

      <Tabs defaultValue={can.clinical ? 'chart' : 'appointments'}>
        <TabsList className="flex-wrap h-auto">
          {can.clinical && <TabsTrigger value="chart">Odontogram</TabsTrigger>}
          {can.clinical && <TabsTrigger value="visits">Visits</TabsTrigger>}
          {can.plans && <TabsTrigger value="plans">Treatment plans</TabsTrigger>}
          {can.appointments && <TabsTrigger value="appointments">Appointments</TabsTrigger>}
          {can.files && <TabsTrigger value="files">Files</TabsTrigger>}
          {can.billing && <TabsTrigger value="billing">Billing</TabsTrigger>}
          <TabsTrigger value="about">Details</TabsTrigger>
        </TabsList>

        {can.clinical && (
          <TabsContent value="chart" className="mt-4">
            <Odontogram
              patientId={id}
              conditions={data.chart}
              dateOfBirth={dob}
              onChange={load}
            />
          </TabsContent>
        )}

        {can.clinical && (
          <TabsContent value="visits" className="mt-4">
            <Panel title="Visit history" empty={!data.visits.length} emptyText="No visits recorded yet.">
              <ul className="divide-y">
                {data.visits.map((v) => (
                  <li key={v.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <Link href={`/visits/${v.id}`} className="font-medium hover:underline">
                        {fmtDate(new Date(v.visitDate))}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {v.chiefComplaint || 'No chief complaint recorded'}
                        {v.dentistName ? ` · ${v.dentistName}` : ''}
                      </div>
                    </div>
                    <Badge variant="secondary">{humanize(v.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
        )}

        {can.plans && (
          <TabsContent value="plans" className="mt-4">
            <Panel title="Treatment plans" empty={!data.treatmentPlans.length} emptyText="No treatment plans yet.">
              <ul className="divide-y">
                {data.treatmentPlans.map((plan) => (
                  <li key={plan.id} className="py-3 flex items-start justify-between gap-4">
                    <div>
                      <Link href={`/treatment-plans/${plan.id}`} className="font-medium hover:underline">
                        {plan.title}
                      </Link>
                      <div className="text-sm text-muted-foreground">
                        {plan.acceptedAt
                          ? `Accepted ${fmtDate(new Date(plan.acceptedAt))}`
                          : plan.proposedAt
                            ? `Proposed ${fmtDate(new Date(plan.proposedAt))}`
                            : 'Draft'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{formatPKR(plan.netAmount)}</div>
                      <Badge variant="secondary">{humanize(plan.status)}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
        )}

        {can.appointments && (
          <TabsContent value="appointments" className="mt-4 space-y-4">
            <Panel title="Upcoming" empty={!data.appointments.upcoming.length} emptyText="Nothing booked.">
              <ul className="divide-y">
                {data.appointments.upcoming.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{fmtDateTime(new Date(a.startAt))}</div>
                      <div className="text-sm text-muted-foreground">
                        {humanize(a.type)}
                        {a.dentistName ? ` · ${a.dentistName}` : ''}
                      </div>
                    </div>
                    <Badge variant="secondary">{humanize(a.status)}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Past" empty={!data.appointments.past.length} emptyText="No past appointments.">
              <ul className="divide-y">
                {data.appointments.past.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div>{fmtDateTime(new Date(a.startAt))}</div>
                      <div className="text-sm text-muted-foreground">{humanize(a.type)}</div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={a.status === 'no_show' ? 'bg-destructive/10 text-destructive' : ''}
                    >
                      {humanize(a.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
        )}

        {can.files && (
          <TabsContent value="files" className="mt-4">
            <Panel title="X-rays, photographs and documents" empty={!data.files.length} emptyText="No files uploaded.">
              <ul className="divide-y">
                {data.files.map((f) => (
                  <li key={f.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{f.title || humanize(f.fileType)}</div>
                      <div className="text-sm text-muted-foreground">
                        {[
                          humanize(f.fileType),
                          f.toothNumber ? `Tooth ${f.toothNumber}` : null,
                          f.photoStage ? humanize(f.photoStage) : null,
                          fmtDate(new Date(f.createdAt)),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </TabsContent>
        )}

        {can.billing && data.billing && (
          <TabsContent value="billing" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Account</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Line label="Billed" value={formatPKR(data.billing.billed)} />
                <Line label="Paid" value={formatPKR(data.billing.paid)} />
                <Line label="Outstanding on invoices" value={formatPKR(data.billing.outstanding)} />
                <Line label="Credit on account" value={formatPKR(data.billing.unallocatedCredit)} />
                <div className="sm:col-span-2 border-t pt-3">
                  <Line
                    label="Net balance"
                    value={formatPKR(data.billing.netBalance)}
                    strong
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="about" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Line label="Phone" value={String(p.phone)} />
              <Line label="Alternative phone" value={(p.altPhone as string) || '—'} />
              <Line label="Email" value={(p.email as string) || '—'} />
              <Line label="City" value={(p.city as string) || '—'} />
              <Line label="Address" value={(p.address as string) || '—'} />
              <Line label="CNIC" value={(p.cnic as string) || '—'} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Emergency contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Line label="Name" value={(p.emergencyContactName as string) || '—'} />
              <Line label="Phone" value={(p.emergencyContactPhone as string) || '—'} />
              <Line label="Relationship" value={(p.emergencyContactRelation as string) || '—'} />
              <Line label="Guardian" value={(p.guardianName as string) || '—'} />
            </CardContent>
          </Card>
          {(p.medicalNotes || p.dentalNotes) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {p.medicalNotes && (
                  <div>
                    <div className="font-medium mb-0.5">Medical</div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{String(p.medicalNotes)}</p>
                  </div>
                )}
                {p.dentalNotes && (
                  <div>
                    <div className="font-medium mb-0.5">Dental</div>
                    <p className="text-muted-foreground whitespace-pre-wrap">{String(p.dentalNotes)}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`text-2xl font-semibold mt-1 ${tone === 'warn' ? 'text-amber-600 dark:text-amber-500' : ''}`}
        >
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Panel({
  title,
  empty,
  emptyText,
  children,
}: {
  title: string;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? <p className="text-sm text-muted-foreground">{emptyText}</p> : children}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}
