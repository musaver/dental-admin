'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, qs, ApiError } from '@/lib/api-client';
import { ageFrom, fmtDate } from '@/lib/datetime';
import { patientName } from '@/lib/patient-identity';
import { humanize } from '@/lib/enums';
import type { Paginated } from '@/lib/pagination';

interface PatientRow {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  status: string;
  hasAlerts: boolean;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  inactive: 'bg-muted text-muted-foreground',
  archived: 'bg-muted text-muted-foreground',
  deceased: 'bg-muted text-muted-foreground',
};

function PatientsList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Search and paging live in the URL so a result set can be shared, and the
  // back button behaves.
  const search = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const [input, setInput] = useState(search);
  const [data, setData] = useState<Paginated<PatientRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.get<Paginated<PatientRow>>(`/api/patients${qs({ q: search, status, page })}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load patients.');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const setParams = (next: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    }
    router.push(`/patients?${params.toString()}`);
  };

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Patients</h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {data.total} {data.total === 1 ? 'patient' : 'patients'}
            </p>
          )}
        </div>
        <Button asChild variant="success">
          <Link href="/patients/new">Register patient</Link>
        </Button>
      </div>

      <form
        className="flex flex-wrap gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: input, page: 1 });
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search by name, MRN or phone number"
          className="max-w-sm"
          aria-label="Search patients"
        />
        <select
          value={status}
          onChange={(e) => setParams({ status: e.target.value, page: 1 })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filter by status"
        >
          <option value="">Active &amp; inactive</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {(search || status) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setInput('');
              router.push('/patients');
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error && (
        <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MRN</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Registered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}

            {!loading && data?.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  {search ? `No patients match “${search}”.` : 'No patients registered yet.'}
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              data?.rows.map((p) => {
                const dob = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
                const age = ageFrom(dob);
                return (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/patients/${p.id}`)}>
                    <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                    <TableCell>
                      <Link href={`/patients/${p.id}`} className="font-medium hover:underline">
                        {patientName(p)}
                      </Link>
                      {p.hasAlerts && (
                        <span
                          className="ml-2 inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
                          title="This patient has medical alerts"
                        >
                          Alert
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {age === null ? '—' : `${age}`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.phone}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[p.status] ?? ''} variant="secondary">
                        {humanize(p.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {fmtDate(new Date(p.createdAt))}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </Card>

      {data && data.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
              onClick={() => setParams({ page: data.page - 1 })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.pageCount}
              onClick={() => setParams({ page: data.page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PatientsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <PatientsList />
    </Suspense>
  );
}
