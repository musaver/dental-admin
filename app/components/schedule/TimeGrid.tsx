'use client';

import { useMemo } from 'react';
import { fmtTime, minutesSinceMidnight, toHHMM } from '@/lib/datetime';
import { statusStyle } from './statusStyles';
import { cn } from '@/lib/utils';

/**
 * The calendar surface.
 *
 * One component covers day-by-chair, day-by-dentist and week-by-day: a
 * "column" is whatever resource you hand it. Hand-rolled rather than using a
 * library because the two candidates both fail on this project's constraints —
 * FullCalendar puts resource views behind a paid licence, and react-big-calendar
 * reads times with local-timezone getters, which contradicts the naive
 * wall-clock convention the whole schema depends on.
 *
 * Geometry is simple: every appointment is absolutely positioned inside its
 * column, offset by (start − dayStart) and sized by its duration. Overlapping
 * appointments share the width in lanes.
 */

export interface GridColumn {
  id: string;
  label: string;
  sublabel?: string;
}

export interface GridEvent {
  id: string;
  columnId: string;
  start: Date;
  end: Date;
  title: string;
  subtitle?: string;
  status: string;
  isWalkIn?: boolean;
  hasAlerts?: boolean;
}

interface Props {
  columns: GridColumn[];
  events: GridEvent[];
  dayStartMinutes: number;
  dayEndMinutes: number;
  slotMinutes: number;
  /** Shaded as unavailable. Minutes since midnight, per column. */
  unavailable?: Record<string, { start: number; end: number }[]>;
  onSlotClick?: (columnId: string, startMinutes: number) => void;
  onEventClick?: (eventId: string) => void;
  pixelsPerSlot?: number;
}

/** Assign overlapping events to lanes so none is hidden behind another. */
function assignLanes(events: GridEvent[]): Map<string, { lane: number; lanes: number }> {
  const layout = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());

  // A cluster is a run of events that transitively overlap; lanes are counted
  // per cluster so a busy hour does not squeeze the whole day.
  let cluster: GridEvent[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assignment = new Map<string, number>();

    for (const event of cluster) {
      let lane = laneEnds.findIndex((end) => end <= event.start.getTime());
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = event.end.getTime();
      assignment.set(event.id, lane);
    }

    for (const event of cluster) {
      layout.set(event.id, { lane: assignment.get(event.id)!, lanes: laneEnds.length });
    }
    cluster = [];
  };

  for (const event of sorted) {
    if (event.start.getTime() >= clusterEnd) {
      flush();
      clusterEnd = event.end.getTime();
    } else {
      clusterEnd = Math.max(clusterEnd, event.end.getTime());
    }
    cluster.push(event);
  }
  flush();

  return layout;
}

export default function TimeGrid({
  columns,
  events,
  dayStartMinutes,
  dayEndMinutes,
  slotMinutes,
  unavailable = {},
  onSlotClick,
  onEventClick,
  pixelsPerSlot = 18,
}: Props) {
  const rows = Math.max(1, Math.ceil((dayEndMinutes - dayStartMinutes) / slotMinutes));
  const height = rows * pixelsPerSlot;

  const layout = useMemo(() => assignLanes(events), [events]);

  const eventsByColumn = useMemo(() => {
    const map = new Map<string, GridEvent[]>();
    for (const event of events) {
      const list = map.get(event.columnId);
      if (list) list.push(event);
      else map.set(event.columnId, [event]);
    }
    return map;
  }, [events]);

  /** Minutes → pixels from the top of the grid. */
  const y = (minutes: number) =>
    ((Math.max(minutes, dayStartMinutes) - dayStartMinutes) / slotMinutes) * pixelsPerSlot;

  // An hourly rule reads better than one line per 15 minutes.
  const hourMarks: number[] = [];
  for (let m = Math.ceil(dayStartMinutes / 60) * 60; m < dayEndMinutes; m += 60) {
    hourMarks.push(m);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max">
        {/* Time gutter */}
        <div className="w-16 shrink-0 select-none" style={{ paddingTop: 32 }}>
          <div className="relative" style={{ height }}>
            {hourMarks.map((minutes) => (
              <div
                key={minutes}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground"
                style={{ top: y(minutes) }}
              >
                {toHHMM(minutes)}
              </div>
            ))}
          </div>
        </div>

        {columns.map((column) => {
          const columnEvents = eventsByColumn.get(column.id) ?? [];
          const blocked = unavailable[column.id] ?? [];

          return (
            <div key={column.id} className="min-w-[180px] flex-1 border-l first:border-l-0">
              <div className="h-8 border-b px-2 flex flex-col justify-center">
                <div className="text-sm font-medium leading-tight truncate">{column.label}</div>
                {column.sublabel && (
                  <div className="text-[11px] text-muted-foreground leading-tight truncate">
                    {column.sublabel}
                  </div>
                )}
              </div>

              <div className="relative" style={{ height }}>
                {/* Clickable empty slots, behind everything else. */}
                {Array.from({ length: rows }, (_, i) => {
                  const minutes = dayStartMinutes + i * slotMinutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      aria-label={`Book at ${toHHMM(minutes)} in ${column.label}`}
                      onClick={() => onSlotClick?.(column.id, minutes)}
                      disabled={!onSlotClick}
                      className={cn(
                        'absolute left-0 right-0 border-b border-dashed border-border/40',
                        onSlotClick && 'hover:bg-primary/5'
                      )}
                      style={{ top: i * pixelsPerSlot, height: pixelsPerSlot }}
                    />
                  );
                })}

                {/* Hour rules */}
                {hourMarks.map((minutes) => (
                  <div
                    key={minutes}
                    className="pointer-events-none absolute left-0 right-0 border-t border-border"
                    style={{ top: y(minutes) }}
                  />
                ))}

                {/* Outside the roster: hatched rather than hidden, so it is
                    clear the time exists but is not being worked. */}
                {blocked.map((range, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute left-0 right-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,var(--color-muted)_5px,var(--color-muted)_10px)] opacity-60"
                    style={{ top: y(range.start), height: y(range.end) - y(range.start) }}
                  />
                ))}

                {columnEvents.map((event) => {
                  const startMinutes = minutesSinceMidnight(event.start);
                  const endMinutes = minutesSinceMidnight(event.end);
                  const lane = layout.get(event.id) ?? { lane: 0, lanes: 1 };
                  const width = 100 / lane.lanes;
                  const style = statusStyle(event.status);

                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onEventClick?.(event.id)}
                      title={`${fmtTime(event.start)}–${fmtTime(event.end)} · ${event.title}`}
                      className={cn(
                        'absolute overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-shadow hover:shadow-md hover:z-10',
                        style.block
                      )}
                      style={{
                        top: y(startMinutes) + 1,
                        height: Math.max(pixelsPerSlot - 2, y(endMinutes) - y(startMinutes) - 2),
                        left: `calc(${lane.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                    >
                      <div className="flex items-center gap-1 font-medium truncate">
                        {event.hasAlerts && (
                          <span className="text-destructive" title="Medical alert" aria-hidden>
                            ●
                          </span>
                        )}
                        {event.isWalkIn && <span title="Walk-in" aria-hidden>⚡</span>}
                        <span className="truncate">{event.title}</span>
                      </div>
                      <div className="truncate opacity-80">
                        {fmtTime(event.start)}
                        {event.subtitle ? ` · ${event.subtitle}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
