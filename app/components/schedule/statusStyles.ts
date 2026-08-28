import { APPOINTMENT_STATUS } from '@/lib/enums';

/**
 * Appointment colours.
 *
 * Every class name is a COMPLETE literal. Tailwind v4 scans source text for
 * whole class names, so a string built by interpolation — `bg-${colour}-500` —
 * is invisible to it and renders unstyled in production while looking fine in
 * development.
 */
export const STATUS_STYLES: Record<string, { block: string; dot: string; label: string }> = {
  [APPOINTMENT_STATUS.SCHEDULED]: {
    block: 'bg-sky-100 border-sky-400 text-sky-950 dark:bg-sky-950 dark:border-sky-700 dark:text-sky-100',
    dot: 'bg-sky-500',
    label: 'Scheduled',
  },
  [APPOINTMENT_STATUS.CONFIRMED]: {
    block: 'bg-indigo-100 border-indigo-400 text-indigo-950 dark:bg-indigo-950 dark:border-indigo-700 dark:text-indigo-100',
    dot: 'bg-indigo-500',
    label: 'Confirmed',
  },
  [APPOINTMENT_STATUS.CHECKED_IN]: {
    block: 'bg-amber-100 border-amber-400 text-amber-950 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-100',
    dot: 'bg-amber-500',
    label: 'Checked in',
  },
  [APPOINTMENT_STATUS.IN_PROGRESS]: {
    block: 'bg-violet-100 border-violet-400 text-violet-950 dark:bg-violet-950 dark:border-violet-700 dark:text-violet-100',
    dot: 'bg-violet-500',
    label: 'In chair',
  },
  [APPOINTMENT_STATUS.COMPLETED]: {
    block: 'bg-emerald-100 border-emerald-400 text-emerald-950 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-100',
    dot: 'bg-emerald-500',
    label: 'Completed',
  },
  [APPOINTMENT_STATUS.CANCELLED]: {
    block: 'bg-neutral-100 border-neutral-300 text-neutral-500 line-through dark:bg-neutral-900 dark:border-neutral-700 dark:text-neutral-400',
    dot: 'bg-neutral-400',
    label: 'Cancelled',
  },
  [APPOINTMENT_STATUS.NO_SHOW]: {
    block: 'bg-red-100 border-red-400 text-red-950 dark:bg-red-950 dark:border-red-700 dark:text-red-100',
    dot: 'bg-red-500',
    label: 'No show',
  },
};

export const statusStyle = (status: string) =>
  STATUS_STYLES[status] ?? {
    block: 'bg-muted border-border text-foreground',
    dot: 'bg-neutral-400',
    label: status,
  };

/** Order the legend and the queue read in, rather than alphabetically. */
export const STATUS_ORDER: string[] = [
  APPOINTMENT_STATUS.SCHEDULED,
  APPOINTMENT_STATUS.CONFIRMED,
  APPOINTMENT_STATUS.CHECKED_IN,
  APPOINTMENT_STATUS.IN_PROGRESS,
  APPOINTMENT_STATUS.COMPLETED,
  APPOINTMENT_STATUS.NO_SHOW,
  APPOINTMENT_STATUS.CANCELLED,
];
