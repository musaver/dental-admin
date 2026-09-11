'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api-client';
import { fmtDate } from '@/lib/datetime';
import { formatPKR } from '@/lib/money';
import { humanize } from '@/lib/enums';
import { parseTeeth, toothCount } from '@/lib/odontogram';
import { patientName } from '@/lib/patient-identity';

interface VisitData {
  visit: {
    id: string;
    visitDate: string;
    status: string;
    chiefComplaint: string | null;
    examinationNotes: string | null;
    treatmentNotes: string | null;
    followUpInstructions: string | null;
    bloodPressure: string | null;
    patientId: string;
  };
  patient: { id: string; mrn: string; firstName: string; lastName: string | null } | null;
  dentist: { id: string; name: string | null; licenseNumber: string | null } | null;
  permissions: { billing: boolean; billingCreate: boolean };
  invoices: InvoiceRow[];
  procedures: PerformedRow[];
  diagnoses: DiagnosisRow[];
  prescriptions: RxRow[];
}
interface PerformedRow {
  id: string; procedureName: string | null; teeth: string | null;
  price: number; status: string; isPerTooth: boolean | null;
  treatmentPlanItemId: string | null; invoiced: boolean;
}
interface InvoiceRow {
  id: string; invoiceNumber: string; issueDate: string;
  totalAmount: number; paidAmount: number; status: string;
}
interface DiagnosisRow {
  id: string; toothNumber: string | null; code: string | null; description: string;
}
interface RxRow {
  id: string;
  items: { id: string; drugName: string; dosage: string | null; frequency: string | null; durationDays: number | null; instructions: string | null }[];
}
interface Procedure { id: string; name: string; defaultPrice: number; isPerTooth: boolean | null }

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export default function VisitPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<VisitData | null>(null);
  const [catalogue, setCatalogue] = useState<Procedure[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [notes, setNotes] = useState({
    chiefComplaint: '', examinationNotes: '', treatmentNotes: '',
    followUpInstructions: '', bloodPressure: '',
  });
  const [notesDirty, setNotesDirty] = useState(false);

  const [newProcedure, setNewProcedure] = useState({ procedureId: '', teeth: '' });
  const [newDiagnosis, setNewDiagnosis] = useState({ toothNumber: '', description: '' });
  const [rxLines, setRxLines] = useState([{ drugName: '', dosage: '', frequency: '', durationDays: '', instructions: '' }]);

  const load = useCallback(async () => {
    try {
      const result = await api.get<VisitData>(`/api/visits/${id}`);
      setData(result);
      setNotes({
        chiefComplaint: result.visit.chiefComplaint ?? '',
        examinationNotes: result.visit.examinationNotes ?? '',
        treatmentNotes: result.visit.treatmentNotes ?? '',
        followUpInstructions: result.visit.followUpInstructions ?? '',
        bloodPressure: result.visit.bloodPressure ?? '',
      });
      setNotesDirty(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the visit.');
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
      // A colleague billed this first, or it is open in another tab. The
      // message says "already been billed" while the button still claims
      // otherwise, so reload rather than leaving the two disagreeing.
      if (err instanceof ApiError && err.code === 'NOTHING_TO_INVOICE') await load();
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <div className="p-4"><div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div></div>;
  }
  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const editable = data.visit.status === 'in_progress';
  const can = data.permissions;
  const completed = data.visit.status === 'completed';
  // `invoiced` is computed server-side against BOTH invoice_items pointers, so
  // this matches buildLinesFromVisit()'s filter. If the two drift, the button
  // offers an invoice the server refuses and comes straight back.
  const hasUnbilled = data.procedures.some((p) => p.status !== 'cancelled' && !p.invoiced);
  const chosen = catalogue.find((p) => p.id === newProcedure.procedureId);
  const chosenTeeth = parseTeeth(newProcedure.teeth.split(/[\s,]+/).join(','));
  const chosenUnits = chosen?.isPerTooth && chosenTeeth.length ? chosenTeeth.length : 1;

  return (
    <div className="p-4 max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visit · {fmtDate(new Date(data.visit.visitDate))}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data.patient && (
              <Link href={`/patients/${data.patient.id}`} className="hover:underline">
                {patientName(data.patient)} ({data.patient.mrn})
              </Link>
            )}
            {data.dentist?.name ? <> · {data.dentist.name}</> : null}
          </p>
        </div>
        <Badge variant="secondary">{humanize(data.visit.status)}</Badge>
      </div>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {/* Clinical notes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Clinical notes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {([
            ['chiefComplaint', 'Chief complaint'],
            ['examinationNotes', 'Examination'],
            ['treatmentNotes', 'Treatment'],
            ['followUpInstructions', 'Follow-up instructions'],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{label}</Label>
              <Textarea
                id={key}
                rows={2}
                value={notes[key]}
                disabled={!editable}
                onChange={(e) => {
                  setNotes({ ...notes, [key]: e.target.value });
                  setNotesDirty(true);
                }}
              />
            </div>
          ))}
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="bp">Blood pressure</Label>
              <Input
                id="bp"
                className="w-28"
                placeholder="120/80"
                maxLength={10}
                value={notes.bloodPressure}
                disabled={!editable}
                onChange={(e) => {
                  setNotes({ ...notes, bloodPressure: e.target.value });
                  setNotesDirty(true);
                }}
              />
            </div>
            {editable && (
              <Button
                disabled={busy || !notesDirty}
                onClick={() =>
                  run(() =>
                    api.put(`/api/visits/${id}`, {
                      ...notes,
                      bloodPressure: notes.bloodPressure || null,
                    })
                  )
                }
              >
                Save notes
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Procedures performed */}
      <Card>
        <CardHeader><CardTitle className="text-base">Procedures performed</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.procedures.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          )}
          <ul className="divide-y">
            {data.procedures.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{p.procedureName ?? 'Procedure'}</span>
                  {p.teeth && <span className="text-muted-foreground"> · teeth {p.teeth}</span>}
                  {can.billing && p.invoiced && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Invoiced</Badge>
                  )}
                </div>
                <span>
                  {formatPKR(p.price * (p.isPerTooth && p.teeth ? toothCount(p.teeth) : 1))}
                </span>
              </li>
            ))}
          </ul>

          {editable && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] items-end border-t pt-3">
              <div className="space-y-1">
                <Label htmlFor="proc">Procedure</Label>
                <select
                  id="proc"
                  className={selectClass}
                  value={newProcedure.procedureId}
                  onChange={(e) => setNewProcedure({ ...newProcedure, procedureId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {catalogue.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatPKR(p.defaultPrice)}{p.isPerTooth ? ' /tooth' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="teeth">Teeth (FDI)</Label>
                <Input
                  id="teeth"
                  className="w-32"
                  placeholder="16, 17"
                  value={newProcedure.teeth}
                  onChange={(e) => setNewProcedure({ ...newProcedure, teeth: e.target.value })}
                />
              </div>
              <Button
                disabled={busy || !newProcedure.procedureId}
                onClick={() =>
                  run(async () => {
                    await api.post(`/api/visits/${id}/procedures`, {
                      procedureId: newProcedure.procedureId,
                      teeth: chosenTeeth,
                    });
                    setNewProcedure({ procedureId: '', teeth: '' });
                  })
                }
              >
                Add{chosen && chosenUnits > 1 ? ` (${chosenUnits}×)` : ''}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diagnoses */}
      <Card>
        <CardHeader><CardTitle className="text-base">Diagnoses</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.diagnoses.length === 0 && (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          )}
          <ul className="divide-y">
            {data.diagnoses.map((d) => (
              <li key={d.id} className="py-2 text-sm">
                {d.toothNumber && <span className="font-mono text-xs mr-2">[{d.toothNumber}]</span>}
                {d.description}
                {d.code && <span className="text-muted-foreground"> ({d.code})</span>}
              </li>
            ))}
          </ul>

          {editable && (
            <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] items-end border-t pt-3">
              <div className="space-y-1">
                <Label htmlFor="dxTooth">Tooth</Label>
                <Input
                  id="dxTooth"
                  className="w-20"
                  placeholder="16"
                  maxLength={2}
                  value={newDiagnosis.toothNumber}
                  onChange={(e) => setNewDiagnosis({ ...newDiagnosis, toothNumber: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dxText">Diagnosis</Label>
                <Input
                  id="dxText"
                  value={newDiagnosis.description}
                  maxLength={500}
                  onChange={(e) => setNewDiagnosis({ ...newDiagnosis, description: e.target.value })}
                />
              </div>
              <Button
                disabled={busy || !newDiagnosis.description.trim()}
                onClick={() =>
                  run(async () => {
                    await api.post(`/api/visits/${id}/diagnoses`, {
                      toothNumber: newDiagnosis.toothNumber || null,
                      description: newDiagnosis.description.trim(),
                    });
                    setNewDiagnosis({ toothNumber: '', description: '' });
                  })
                }
              >
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prescriptions */}
      <Card>
        <CardHeader><CardTitle className="text-base">Prescriptions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.prescriptions.map((rx) => (
            <div key={rx.id} className="rounded-md border p-3 text-sm">
              <ol className="list-decimal pl-5 space-y-0.5">
                {rx.items.map((line) => (
                  <li key={line.id}>
                    <span className="font-medium">{line.drugName}</span>
                    {[line.dosage, line.frequency, line.durationDays ? `${line.durationDays} days` : null, line.instructions]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {editable && (
            <div className="space-y-2 border-t pt-3">
              {rxLines.map((line, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-5">
                  <Input placeholder="Medicine" value={line.drugName}
                    onChange={(e) => setRxLines(rxLines.map((l, j) => (j === i ? { ...l, drugName: e.target.value } : l)))} />
                  <Input placeholder="Dosage (500mg)" value={line.dosage}
                    onChange={(e) => setRxLines(rxLines.map((l, j) => (j === i ? { ...l, dosage: e.target.value } : l)))} />
                  <Input placeholder="Frequency (TDS)" value={line.frequency}
                    onChange={(e) => setRxLines(rxLines.map((l, j) => (j === i ? { ...l, frequency: e.target.value } : l)))} />
                  <Input placeholder="Days" type="number" min={1} value={line.durationDays}
                    onChange={(e) => setRxLines(rxLines.map((l, j) => (j === i ? { ...l, durationDays: e.target.value } : l)))} />
                  <Input placeholder="Instructions" value={line.instructions}
                    onChange={(e) => setRxLines(rxLines.map((l, j) => (j === i ? { ...l, instructions: e.target.value } : l)))} />
                </div>
              ))}
              <div className="flex gap-2">
                <Button variant="ghost" size="sm"
                  onClick={() => setRxLines([...rxLines, { drugName: '', dosage: '', frequency: '', durationDays: '', instructions: '' }])}>
                  + Another medicine
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !rxLines.some((l) => l.drugName.trim())}
                  onClick={() =>
                    run(async () => {
                      await api.post(`/api/visits/${id}/prescriptions`, {
                        items: rxLines
                          .filter((l) => l.drugName.trim())
                          .map((l) => ({
                            drugName: l.drugName.trim(),
                            dosage: l.dosage || null,
                            frequency: l.frequency || null,
                            durationDays: l.durationDays ? Number(l.durationDays) : null,
                            instructions: l.instructions || null,
                          })),
                      });
                      setRxLines([{ drugName: '', dosage: '', frequency: '', durationDays: '', instructions: '' }]);
                    })
                  }
                >
                  Write prescription
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {can.billing && data.invoices.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Billing</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link href={`/billing/${inv.id}`} className="font-mono text-xs hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                    <span className="text-muted-foreground"> · {fmtDate(new Date(inv.issueDate))}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>{formatPKR(inv.totalAmount)}</span>
                    <Badge variant="secondary">{humanize(inv.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <>
            <Button
              variant="success"
              disabled={busy}
              onClick={() => run(() => api.put(`/api/visits/${id}`, { status: 'completed' }))}
            >
              Complete visit
            </Button>
            <span className="text-xs text-muted-foreground">
              Completing closes the appointment and generates any recalls.
            </span>
          </>
        )}

        {/* Only once the visit is closed: while it is in progress the
            clinician can still add procedures, and billing mid-visit splits
            one visit across two invoices for no benefit. */}
        {completed && can.billingCreate && hasUnbilled && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api.post<{ invoice: { id: string } }>('/api/invoices', {
                  patientId: data.visit.patientId,
                  visitId: data.visit.id,
                });
                router.push(`/billing/${result.invoice.id}`);
              })
            }
          >
            Raise invoice
          </Button>
        )}
        {completed && can.billingCreate && !hasUnbilled && (
          <span className="text-sm text-muted-foreground">
            Everything from this visit has been invoiced.
          </span>
        )}

        {!editable && (
          <span className="text-sm text-muted-foreground">
            This visit is {humanize(data.visit.status)} and read-only.
          </span>
        )}
      </div>
    </div>
  );
}
