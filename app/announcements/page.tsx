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

export default function AnnouncementsList() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/announcements');
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
    if (confirm('Are you sure you want to delete this announcement?')) {
      try {
        await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
        setItems(items.filter((item: any) => item.announcement.id !== id));
      } catch (error) {
        console.error('Error deleting announcement:', error);
      }
    }
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  const audienceLabel = (item: any) => {
    const a = item.announcement.audience;
    if (a === 'batch') return `Batch: ${item.batch?.batchName || '—'}`;
    if (a === 'course') return `Course: ${item.course?.title || '—'}`;
    if (a === 'custom') return 'Custom';
    return 'All users';
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Announcements</h1>
        <div className="flex gap-2">
          <Button onClick={fetchItems} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/announcements/add">New Announcement</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Title</TableHead>
              <TableHead>Audience</TableHead>
              <TableHead>Recipients</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item: any) => (
                <TableRow key={item.announcement.id}>
                  <TableCell>{item.announcement.title}</TableCell>
                  <TableCell>{audienceLabel(item)}</TableCell>
                  <TableCell>{item.recipientCount ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={item.announcement.emailSent ? 'success' : 'secondary'}>
                      {item.announcement.emailSent ? 'Sent' : 'Not sent'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.announcement.status === 'published' ? 'default' : 'secondary'} className="capitalize">
                      {item.announcement.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(item.announcement.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/announcements/edit/${item.announcement.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(item.announcement.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No announcements found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
