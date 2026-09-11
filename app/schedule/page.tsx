'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import TimeGrid, { type GridColumn, type GridEvent } from '@/app/components/schedule/TimeGrid';
import { STATUS_ORDER, statusStyle } from '@/app/components/schedule/statusStyles';
import AppointmentDialog from '@/app/components/schedule/AppointmentDialog';
import { api, qs, ApiError } from '@/lib/api-client';
import {
  addDays,
  clinicNow,
  fmtDayLabel,
  fromDateKey,
  toDateKey,
  toHHMM,
} from '@/lib/datetime';
import { patientName } from '@/lib/patient-identity';

interface Resources {
  branchId: string | null;
  // A chair's branch is what tells the booking dialog where to register a new
  // patient when head office is looking at every branch at once.
  chairs: { id: string; name: string; branchId: string | null }[];
  dentists: { id: string; name: string | null; staffType: string | null }[];
  hours: { workStartMinutes: number; workEndMinutes: number; slotMinutes: number };
}

interface PatientResult {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  hasAlerts: boolean;
}

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  type: string;
  status: string;
  isWalkIn: boolean;
  chairId: string | null;
  dentistId: string;
  dentistName: string | null;
  patientId: string;
  patientFirstName: string;
  patientLastName: string | null;
  patientHasAlerts: boolean;
}

/** The column a chairless appointment falls into — the schema allows null. */
const UNASSIGNED = '__unassigned__';

function ScheduleView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // All view state lives in the URL, so a day can be shared and the back
  // button behaves.
  const dateKey = searchParams.get('date') ?? toDateKey(clinicNow());
  const groupBy = (searchParams.get('by') ?? 'chair') as 'chair' | 'dentist';
  // Set by "Book appointment" on a chart and "Book" on the recall worklist.
  const bookForPatientId = searchParams.get('patientId');
  const bookForRecallId = searchParams.get('recallId');

  const [resources, setResources] = useState<Resources | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState<{ columnId: string; startMinutes: number } | null>(null);
  const [prefilledPatient, setPrefilledPatient] = useState<PatientResult | null>(null);

  const day = useMemo(() => fromDateKey(dateKey), [dateKey]);

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      router.push(`/schedule?${params.toString()}`);
    },
    [router, searchParams]
  );

  /**
   * Drop the deep-link params once the dialog is done with them, so a refresh
   * or a day change does not reopen the booking form on the same patient.
   */
  const closePrefill = useCallback(() => {
    setPrefilledPatient(null);
    if (bookForPatientId || bookForRecallId) {
      setParams({ patientId: null, recallId: null });
    }
  }, [bookForPatientId, bookForRecallId, setParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [res, appts] = await Promise.all([
        api.get<Resources>('/api/schedule/resources'),
        api.get<Appointment[]>(
          `/api/appointments${qs({
            from: `${dateKey}T00:00:00`,
            to: toDateKey(addDays(day, 1)) + 'T00:00:00',
          })}`
        ),
      ]);
      setResources(res);
      setAppointments(appts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the diary.');
    } finally {
      setLoading(false);
    }
  }, [dateKey, day]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: GridColumn[] = useMemo(() => {
    if (!resources) return [];
    if (groupBy === 'dentist') {
      return resources.dentists.map((d) => ({
        id: d.id,
        label: d.name ?? 'Unnamed',
        sublabel: d.staffType ?? undefined,
      }));
    }
    // Chair mode always includes an Unassigned column — chairId is nullable,
    // so without it those appointments would simply vanish from the diary.
    return [
      ...resources.chairs.map((c) => ({ id: c.id, label: c.name })),
      { id: UNASSIGNED, label: 'Unassigned', sublabel: 'No chair set' },
    ];
  }, [resources, groupBy]);

  /*
   * Arriving with ?patientId= means someone clicked "Book appointment" on a
   * chart or "Book" on a recall. Resolve the patient and open the dialog on
   * them, rather than dropping the caller on an empty diary — which is what
   * both of those buttons used to do.
   */
  useEffect(() => {
    if (!bookForPatientId || !resources || !columns.length) return;
    let cancelled = false;

    api
      .get<{ rows: PatientResult[] }>(`/api/patients${qs({ id: bookForPatientId, pageSize: 1 })}`)
      .then((r) => {
        if (cancelled) return;
        const found = r.rows[0];
        if (!found) {
          setError('That patient could not be found.');
          return;
        }
        setPrefilledPatient(found);
        setBooking(
          (current) =>
            current ?? {
              columnId: columns[0]!.id,
              startMinutes: resources.hours.workStartMinutes,
            }
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load that patient.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bookForPatientId, resources, columns]);

  const events: GridEvent[] = useMemo(
    () =>
      appointments.map((a) => ({
        id: a.id,
        columnId: groupBy === 'dentist' ? a.dentistId : (a.chairId ?? UNASSIGNED),
        start: new Date(a.startAt),
        end: new Date(a.endAt),
        title: patientName({ firstName: a.patientFirstName, lastName: a.patientLastName }),
        subtitle: groupBy === 'dentist' ? a.type : (a.dentistName ?? undefined),
        status: a.status,
        isWalkIn: a.isWalkIn,
        hasAlerts: a.patientHasAlerts,
      })),
    [appointments, groupBy]
  );

  const isToday = dateKey === toDateKey(clinicNow());
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appointments) map[a.status] = (map[a.status] ?? 0) + 1;
    return map;
  }, [appointments]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{fmtDayLabel(day)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
            {isToday ? ' · today' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setParams({ date: toDateKey(addDays(day, -1)) })}>
            ←
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setParams({ date: toDateKey(clinicNow()) })}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setParams({ date: toDateKey(addDays(day, 1)) })}>
            →
          </Button>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => e.target.value && setParams({ date: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Jump to date"
          />
          <div className="flex rounded-md border border-input overflow-hidden">
            {(['chair', 'dentist'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setParams({ by: mode })}
                className={`px-2.5 py-1 text-sm transition-colors ${
                  groupBy === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {mode === 'chair' ? 'Chairs' : 'Dentists'}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setBooking({ columnId: columns[0]?.id ?? '', startMinutes: resources?.hours.workStartMinutes ?? 540 })}>
            New appointment
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <div className="text-muted-foreground text-sm">Loading the diary…</div>}

      {!loading && resources && columns.length > 0 && (
        <>
          <Card className="py-0 overflow-hidden">
            <TimeGrid
              columns={columns}
              events={events}
              dayStartMinutes={resources.hours.workStartMinutes}
              dayEndMinutes={resources.hours.workEndMinutes}
              slotMinutes={resources.hours.slotMinutes}
              onSlotClick={(columnId, startMinutes) => setBooking({ columnId, startMinutes })}
              onEventClick={(id) => router.push(`/schedule/${id}`)}
            />
          </Card>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {STATUS_ORDER.filter((s) => counts[s]).map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${statusStyle(status).dot}`} />
                {statusStyle(status).label}
                <span className="text-muted-foreground">({counts[status]})</span>
              </span>
            ))}
            <span className="text-muted-foreground ml-auto">
              {toHHMM(resources.hours.workStartMinutes)}–{toHHMM(resources.hours.workEndMinutes)},{' '}
              {resources.hours.slotMinutes} minute slots
            </span>
          </div>
        </>
      )}

      {!loading && resources && columns.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          No chairs or dentists are set up for this branch yet.
        </Card>
      )}

      {booking && resources && (
        <AppointmentDialog
          date={day}
          startMinutes={booking.startMinutes}
          chairId={groupBy === 'chair' && booking.columnId !== UNASSIGNED ? booking.columnId : null}
          dentistId={groupBy === 'dentist' ? booking.columnId : null}
          resources={resources}
          initialPatient={prefilledPatient}
          recallId={bookForRecallId}
          onClose={() => {
            setBooking(null);
            closePrefill();
          }}
          onBooked={() => {
            setBooking(null);
            closePrefill();
            load();
          }}
        />
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <ScheduleView />
    </Suspense>
  );
}
