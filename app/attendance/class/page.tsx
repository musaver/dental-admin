'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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

export default function AttendanceByClassSelector() {
  const router = useRouter();
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/classes')
      .then((res) => res.json())
      .then((data) => setClasses(Array.isArray(data) ? data : []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const fmt = (d: string) => (d ? new Date(d).toLocaleString() : '—');

  const filtered = classes.filter((item: any) => {
    const q = search.toLowerCase();
    return (
      item.class.title?.toLowerCase().includes(q) ||
      item.course?.title?.toLowerCase().includes(q) ||
      item.batch?.batchName?.toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Attendance by Class</h1>
          <p className="text-muted-foreground mt-1">Pick a class to view and sync its Zoom attendance</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/attendance">← All Attendance</Link>
        </Button>
      </div>

      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by class, course or batch…"
        className="max-w-md mb-4"
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Class</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Zoom</TableHead>
              <TableHead className="text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length > 0 ? (
              filtered.map((item: any) => (
                <TableRow key={item.class.id}>
                  <TableCell className="font-medium">{item.class.title}</TableCell>
                  <TableCell className="text-muted-foreground">{item.course?.title || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{item.batch?.batchName || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{fmt(item.class.scheduledAt)}</TableCell>
                  <TableCell>
                    {item.class.zoomMeetingId || item.class.zoomLink ? (
                      <Badge variant="success">Linked</Badge>
                    ) : (
                      <Badge variant="secondary">None</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => router.push(`/attendance/class/${item.class.id}?name=${encodeURIComponent(item.class.title)}`)}
                    >
                      View Attendance
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No classes found</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
