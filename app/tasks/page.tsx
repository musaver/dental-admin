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

export default function TasksList() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this task? Its comments will be removed too.')) {
      try {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        setItems(items.filter((item: any) => item.task.id !== id));
      } catch (error) {
        console.error('Error deleting task:', error);
      }
    }
  };

  const fmt = (d: string) => (d ? new Date(d).toLocaleString() : '—');

  const statusBadge = (s: string) => {
    const map: Record<string, 'default' | 'success' | 'destructive' | 'secondary'> = {
      open: 'default',
      completed: 'success',
      cancelled: 'destructive',
    };
    return <Badge variant={map[s] || 'secondary'} className="capitalize">{s}</Badge>;
  };

  const priorityBadge = (p: string) => {
    const map: Record<string, 'destructive' | 'secondary'> = {
      high: 'destructive',
      normal: 'secondary',
      low: 'secondary',
    };
    return <Badge variant={map[p] || 'secondary'} className="capitalize">{p}</Badge>;
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <div className="flex gap-2">
          <Button onClick={fetchItems} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/tasks/add">New Task</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Comments</TableHead>
              <TableHead>Announcement</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item: any) => (
                <TableRow key={item.task.id}>
                  <TableCell>{item.task.title}</TableCell>
                  <TableCell>
                    {item.class?.title || 'Unknown'}
                    {item.batch?.batchName ? ` (${item.batch.batchName})` : ''}
                  </TableCell>
                  <TableCell>{fmt(item.task.dueDate)}</TableCell>
                  <TableCell>{priorityBadge(item.task.priority)}</TableCell>
                  <TableCell>{statusBadge(item.task.status)}</TableCell>
                  <TableCell>{item.commentCount ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={item.task.announcementSent ? 'success' : 'secondary'}>
                      {item.task.announcementSent ? 'Sent' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/tasks/edit/${item.task.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(item.task.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No tasks found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
