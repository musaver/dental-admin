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

export default function RecordingsList() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recordings');
      const data = await res.json();
      setRecordings(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this recording?')) {
      try {
        await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
        setRecordings(recordings.filter((recording: any) => recording.recording.id !== id));
      } catch (error) {
        console.error('Error deleting recording:', error);
      }
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Recordings</h1>
        <div className="flex gap-2">
          <Button onClick={fetchRecordings} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/recordings/add">Add New Recording</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Recording Title</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Recording Date & Time</TableHead>
              <TableHead>Recording URL</TableHead>
              <TableHead>Show to All Users</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recordings.length > 0 ? (
              recordings.map((item: any) => (
                <TableRow key={item.recording.id}>
                  <TableCell>{item.recording.recordingTitle}</TableCell>
                  <TableCell>
                    {item.class?.title || <span className="text-muted-foreground">Not linked</span>}
                  </TableCell>
                  <TableCell>{item.batch?.batchName || 'Unknown Batch'}</TableCell>
                  <TableCell>{item.course?.title || 'Unknown Course'}</TableCell>
                  <TableCell>{formatDateTime(item.recording.recordingDateTime)}</TableCell>
                  <TableCell>
                    {item.recording.recordingUrl ? (
                      <a
                        href={item.recording.recordingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-all"
                      >
                        {item.recording.recordingUrl.length > 50
                          ? item.recording.recordingUrl.substring(0, 50) + '...'
                          : item.recording.recordingUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">No URL</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.recording.showToAllUsers ? 'success' : 'destructive'}>
                      {item.recording.showToAllUsers ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(item.recording.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/recordings/edit/${item.recording.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(item.recording.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No recordings found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
