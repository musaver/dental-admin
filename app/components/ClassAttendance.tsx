'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface ClassAttendanceProps {
  classId: string;
}

export default function ClassAttendance({ classId }: ClassAttendanceProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/class/${classId}`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/attendance/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');

      const r = data.results?.[0];
      if (r?.skipped) {
        setMessage(`Nothing synced: ${r.skipped}`);
      } else {
        let msg = `Synced: ${data.matched} matched, ${data.attendanceWritten} recorded.`;
        if (r?.unmatchedParticipants?.length) {
          msg += ` Unmatched (not enrolled / name mismatch): ${r.unmatchedParticipants.join(', ')}.`;
        }
        setMessage(msg);
      }
      await fetchRows();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : '—');

  return (
    <div className="mt-8 border-t pt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Attendance {loading ? '' : `(${rows.length})`}</h2>
        <Button
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing…' : '🔄 Sync Attendance from Zoom'}
        </Button>
      </div>

      {message && <div className="mb-3 rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">{message}</div>}
      {error && <div className="mb-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <p className="text-sm text-muted-foreground mb-3">
        Pulls Zoom's participant report for this class's meeting and records who actually attended.
        Run it a couple of minutes after the class ends. Re-running updates existing rows (no duplicates).
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Left</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.userName || 'Unknown'}</TableCell>
                  <TableCell>{r.userEmail || '—'}</TableCell>
                  <TableCell>{fmt(r.joinTime)}</TableCell>
                  <TableCell>{fmt(r.leaveTime)}</TableCell>
                  <TableCell>{r.durationMinutes != null ? `${r.durationMinutes} min` : '—'}</TableCell>
                  <TableCell>
                    <Badge variant={r.source === 'zoom' ? 'success' : 'secondary'}>
                      {r.source === 'zoom' ? 'Zoom (verified)' : r.source || 'self'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="p-4 text-center text-muted-foreground">
                  {loading ? 'Loading…' : 'No attendance recorded yet. Click “Sync Attendance from Zoom” after the class.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
