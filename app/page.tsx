'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';
import { formatPKR } from '@/lib/money';

interface DashboardData {
  today: {
    appointments: number | null;
    waiting: number | null;
    collected: number | null;
  };
  activePatients: number;
  recallsDue: number | null;
  leadsDue: number | null;
  outstanding: { invoices: number; outstanding: number } | null;
  week: { completed: number; noShow: number; noShowRate: number } | null;
}

/**
 * The landing page: today at a glance, then the queues that need someone.
 *
 * One request feeds everything (see /api/dashboard); tiles whose data comes
 * back null are simply not rendered, so the page shapes itself to the
 * caller's permissions with no client-side permission logic to drift.
 */
export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<DashboardData>('/api/dashboard')
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
      );
  }, []);

  if (error) {
    return (
      <div className="p-4">
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!data) return <div className="p-4 text-muted-foreground">Loading…</div>;

  const tiles: { label: string; value: string; hint?: string; href: string; urgent?: boolean }[] = [];

  if (data.today.appointments !== null) {
    tiles.push({
      label: 'Appointments today',
      value: String(data.today.appointments),
      hint: data.today.waiting ? `${data.today.waiting} waiting now` : 'Nobody waiting',
      href: '/schedule',
      urgent: (data.today.waiting ?? 0) > 0,
    });
  }
  if (data.today.collected !== null) {
    tiles.push({
      label: 'Collected today',
      value: formatPKR(data.today.collected),
      hint: data.outstanding
        ? `${formatPKR(data.outstanding.outstanding)} outstanding overall`
        : undefined,
      href: '/billing',
    });
  }
  if (data.recallsDue !== null) {
    tiles.push({
      label: 'Recalls due',
      value: String(data.recallsDue),
      hint: 'Patients to bring back in',
      href: '/recalls',
      urgent: data.recallsDue > 0,
    });
  }
  if (data.leadsDue !== null) {
    tiles.push({
      label: 'Follow-ups due',
      value: String(data.leadsDue),
      hint: 'Enquiries waiting on a call',
      href: '/leads?due=1',
      urgent: data.leadsDue > 0,
    });
  }
  tiles.push({
    label: 'Active patients',
    value: String(data.activePatients),
    href: '/patients',
  });
  if (data.week) {
    tiles.push({
      label: 'No-show rate (7 days)',
      value: `${data.week.noShowRate}%`,
      hint: `${data.week.completed} completed · ${data.week.noShow} missed`,
      href: '/reports/clinical',
      urgent: data.week.noShowRate > 10,
    });
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Today</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="pt-6">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </div>
                <div
                  className={`mt-1 text-3xl font-semibold ${
                    tile.urgent ? 'text-amber-600 dark:text-amber-500' : ''
                  }`}
                >
                  {tile.value}
                </div>
                {tile.hint && (
                  <div className="mt-1 text-xs text-muted-foreground">{tile.hint}</div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
