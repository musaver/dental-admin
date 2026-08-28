'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api, qs, ApiError } from '@/lib/api-client';
import { clinicNow, fmtDate } from '@/lib/datetime';
import { humanize, TASK_PRIORITY, valuesOf } from '@/lib/enums';

interface TaskRow {
  id: string; title: string; description: string | null;
  status: string; priority: string; dueDate: string | null;
  patientId: string | null; assigneeName: string | null;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  high: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  normal: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300',
  low: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900',
};

/**
 * Internal to-dos: "chase the lab about the crown", "call the supplier".
 * Deliberately not the lead follow-up queue — /leads?due=1 is that.
 */
export default function TasksPage() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [mine, setMine] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', priority: 'normal' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(
        await api.get<TaskRow[]>(
          `/api/tasks${qs({ mine: mine ? 1 : null, status: showDone ? null : 'open' })}`
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }, [mine, showDone]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    setBusy(id);
    try {
      await api.patch('/api/tasks', { id, status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the task.');
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('new');
    setError('');
    try {
      await api.post('/api/tasks', {
        title: form.title.trim(),
        description: form.description.trim() || null,
        dueDate: form.dueDate ? `${form.dueDate}T09:00:00` : null,
        priority: form.priority,
      });
      setAdding(false);
      setForm({ title: '', description: '', dueDate: '', priority: 'normal' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the task.');
    } finally {
      setBusy(null);
    }
  }

  const now = clinicNow().getTime();

  return (
    <div className="p-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Internal to-dos. Lead follow-ups live on the{' '}
            <Link href="/leads?due=1" className="underline">leads worklist</Link>.
          </p>
        </div>
        <Button variant="success" onClick={() => setAdding(true)}>New task</Button>
      </div>

      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={mine ? 'default' : 'outline'} onClick={() => setMine(true)}>Mine</Button>
        <Button size="sm" variant={!mine ? 'default' : 'outline'} onClick={() => setMine(false)}>Everyone&rsquo;s</Button>
        <Button size="sm" variant={showDone ? 'default' : 'outline'} onClick={() => setShowDone(!showDone)}>
          {showDone ? 'Hiding nothing' : 'Show done'}
        </Button>
      </div>

      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <Card className="py-0 divide-y">
        {loading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {!loading && rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">Nothing to do. Enjoy it.</div>
        )}
        {!loading && rows.map((task) => {
          const due = task.dueDate ? new Date(task.dueDate) : null;
          const overdue = due !== null && due.getTime() < now && task.status !== 'done';
          const done = task.status === 'done';
          return (
            <div key={task.id} className="flex items-start gap-3 p-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-input"
                checked={done}
                disabled={busy === task.id}
                onChange={() => setStatus(task.id, done ? 'open' : 'done')}
                aria-label={`Mark "${task.title}" ${done ? 'open' : 'done'}`}
              />
              <div className="flex-1">
                <div className={`text-sm font-medium ${done ? 'line-through text-muted-foreground' : ''}`}>
                  {task.title}
                  {task.patientId && (
                    <Link href={`/patients/${task.patientId}`} className="ml-2 text-xs text-muted-foreground underline">
                      patient
                    </Link>
                  )}
                </div>
                {task.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  {task.assigneeName && <span>{task.assigneeName}</span>}
                  {due && (
                    <span className={overdue ? 'font-medium text-amber-600 dark:text-amber-500' : ''}>
                      due {fmtDate(due)}
                    </span>
                  )}
                </div>
              </div>
              <Badge variant="secondary" className={PRIORITY_STYLES[task.priority] ?? ''}>
                {humanize(task.priority)}
              </Badge>
            </div>
          );
        })}
      </Card>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
          <form onSubmit={create} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="taskTitle">What needs doing? <span className="text-destructive">*</span></Label>
              <Input id="taskTitle" required maxLength={255} value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taskDesc">Details</Label>
              <Textarea id="taskDesc" rows={2} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="taskDue">Due</Label>
                <Input id="taskDue" type="date" value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="taskPriority">Priority</Label>
                <select id="taskPriority" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {valuesOf(TASK_PRIORITY).map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" disabled={busy === 'new' || !form.title.trim()}>
                {busy === 'new' ? 'Saving…' : 'Save task'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
