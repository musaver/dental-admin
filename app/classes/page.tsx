'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function ClassesList() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/classes');
      const data = await res.json();
      setClasses(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this class?')) {
      try {
        await fetch(`/api/classes/${id}`, { method: 'DELETE' });
        setClasses(classes.filter((item: any) => item.class.id !== id));
      } catch (error) {
        console.error('Error deleting class:', error);
      }
    }
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const statusBadge = (status: string) => {
    const map: Record<string, 'default' | 'success' | 'secondary' | 'destructive'> = {
      scheduled: 'default',
      live: 'success',
      completed: 'secondary',
      cancelled: 'destructive',
    };
    return (
      <Badge variant={map[status] || 'secondary'} className="capitalize">
        {status || 'scheduled'}
      </Badge>
    );
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Classes</h1>
        <div className="flex gap-2">
          <Button onClick={fetchClasses} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/classes/add">Add New Class</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Title</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Scheduled At</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Zoom</TableHead>
              <TableHead>Recording</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visible</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {classes.length > 0 ? (
              classes.map((item: any) => (
                <TableRow key={item.class.id}>
                  <TableCell>{item.class.title}</TableCell>
                  <TableCell>{item.course?.title || 'Unknown Course'}</TableCell>
                  <TableCell>{item.batch?.batchName || 'Unknown Batch'}</TableCell>
                  <TableCell>{formatDateTime(item.class.scheduledAt)}</TableCell>
                  <TableCell>{item.class.durationMinutes ? `${item.class.durationMinutes} min` : '-'}</TableCell>
                  <TableCell>
                    {item.class.zoomLink ? (
                      <a
                        href={item.class.zoomLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Join
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.class.recordingUrl ? (
                      <a
                        href={item.class.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Watch
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(item.class.status)}</TableCell>
                  <TableCell>
                    <Badge variant={item.class.showToAllUsers ? 'success' : 'destructive'}>
                      {item.class.showToAllUsers ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/classes/edit/${item.class.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(item.class.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground">
                  No classes found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
