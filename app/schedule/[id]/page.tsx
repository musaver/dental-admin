'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, qs, ApiError } from '@/lib/api-client';
import { fmtDateTime, fmtDuration } from '@/lib/datetime';
import { humanize } from '@/lib/enums';
import { patientName } from '@/lib/patient-identity';
import { statusStyle } from '@/app/components/schedule/statusStyles';

interface AppointmentDetail {
  id: string;
  startAt: string;
  endAt: string;
  type: string;
  status: string;
  isWalkIn: boolean;
  reasonNote: string | null;
  cancellationReason: string | null;
  confirmedAt: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
  chairName: string | null;
  dentistId: string;
  dentistName: string | null;
  patientId: string;
  patientMrn: string | null;
  patientFirstName: string;
  patientLastName: string | null;
  patientPhone: string | null;
  patientHasAlerts: boolean;
}

/**
 * One appointment: where the front desk confirms, checks in, starts the
 * visit, completes, cancels or marks a no-show. The buttons offered are
 * exactly the legal transitions from the current status — the server enforces
 * the state machine; this just avoids offering dead ends.
 */
const NEXT_ACTIONS: Record<string, { to: string; label: string; variant?: 'destructive' }[]> = {
  scheduled: [
    { to: 'confirmed', label: 'Confirm' },
    { to: 'checked_in', label: 'Check in' },
    { to: 'no_show', label: 'Mark no-show', variant: 'destructive' },
  ],
  confirmed: [
    { to: 'checked_in', label: 'Check in' },
    { to: 'no_show', label: 'Mark no-show', variant: 'destructive' },
  ],
  checked_in: [{ to: 'completed', label: 'Complete' }],
  in_progress: [{ to: 'completed', label: 'Complete' }],
  no_show: [{ to: 'scheduled', label: 'Undo no-show' }],
};

const CANCELLABLE = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];

export default function AppointmentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    try {
      // The list endpoint carries the joined names; filter it to this id.
      const rows = await api.get<AppointmentDetail[]>(`/api/appointments${qs({})}`);
      const found = rows.find((r) => r.id === id);
      if (!found) {
        setError('Appointment not found.');
        return;
      }
      setAppointment(found);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the appointment.');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(status: string, reason?: string) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/api/appointments/${id}/status`, { status, reason: reason ?? null });
      setCancelOpen(false);
      setCancelReason('');
      await load();
      // Starting the visit belongs on the clinical page.
      if (status === 'checked_in') router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the appointment.');
    } finally {
      setBusy(false);
    }
  }

  async function startVisit() {
    if (!appointment) return;
    setBusy(true);
    setError('');
    try {
      const visit = await api.post<{ id: string }>('/api/visits', {
        patientId: appointment.patientId,
        dentistId: appointment.dentistId,
        appointmentId: appointment.id,
      });
      router.push(`/visits/${visit.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the visit.');
      setBusy(false);
    }
  }

  if (error && !appointment) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        <Button asChild variant="secondary" className="mt-4">
          <Link href="/schedule">Back to the diary</Link>
        </Button>
      </div>
    );
  }
  if (!appointment) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const start = new Date(appointment.startAt);
  const end = new Date(appointment.endAt);
  const style = statusStyle(appointment.status);
  const actions = NEXT_ACTIONS[appointment.status] ?? [];

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{fmtDateTime(start)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {fmtDuration((end.getTime() - start.getTime()) / 60000)} · {humanize(appointment.type)}
            {appointment.isWalkIn ? ' · walk-in' : ''}
          </p>
        </div>
        <Badge variant="secondary" className={style.block}>{style.label}</Badge>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Patient</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <Link href={`/patients/${appointment.patientId}`} className="font-medium hover:underline">
              {patientName({ firstName: appointment.patientFirstName, lastName: appointment.patientLastName })}
            </Link>
            {appointment.patientMrn && (
              <span className="font-mono text-xs text-muted-foreground">{appointment.patientMrn}</span>
            )}
            {appointment.patientHasAlerts && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                Medical alert
              </span>
            )}
          </div>
          {appointment.patientPhone && (
            <div className="font-mono text-xs text-muted-foreground">{appointment.patientPhone}</div>
          )}
          <div className="text-muted-foreground pt-1">
            {appointment.dentistName ?? 'No dentist'} · {appointment.chairName ?? 'No chair assigned'}
          </div>
          {appointment.reasonNote && <p className="pt-1">{appointment.reasonNote}</p>}
          {appointment.cancellationReason && (
            <p className="pt-1 text-destructive">Cancelled: {appointment.cancellationReason}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Progress</CardTitle></CardHeader>
        <CardContent className="grid gap-1.5 text-sm sm:grid-cols-3">
          <Milestone label="Confirmed" at={appointment.confirmedAt} />
          <Milestone label="Checked in" at={appointment.checkedInAt} />
          <Milestone label="Completed" at={appointment.completedAt} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.to}
            variant={action.variant ?? 'default'}
            disabled={busy}
            onClick={() => setStatus(action.to)}
          >
            {action.label}
          </Button>
        ))}
        {(appointment.status === 'checked_in' || appointment.status === 'in_progress') && (
          <Button variant="success" disabled={busy} onClick={startVisit}>
            {appointment.status === 'in_progress' ? 'Open visit' : 'Start visit'}
          </Button>
        )}
        {CANCELLABLE.includes(appointment.status) && (
          <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
            Cancel appointment
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/schedule">Back to the diary</Link>
        </Button>
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancel this appointment</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="cancelReason" className="text-sm font-medium">
              Reason <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="cancelReason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Patient called to cancel"
            />
            <p className="text-xs text-muted-foreground">
              Recorded on the appointment, so the record explains itself later.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={busy || !cancelReason.trim()}
              onClick={() => setStatus('cancelled', cancelReason.trim())}
            >
              Cancel appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Milestone({ label, at }: { label: string; at: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={at ? '' : 'text-muted-foreground'}>
        {at ? fmtDateTime(new Date(at)) : '—'}
      </div>
    </div>
  );
}
