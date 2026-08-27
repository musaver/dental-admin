'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function BatchesList() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/batches');
      const data = await res.json();
      setBatches(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this batch?')) {
      try {
        await fetch(`/api/batches/${id}`, { method: 'DELETE' });
        setBatches(batches.filter((batch: any) => batch.batch.id !== id));
      } catch (error) {
        console.error('Error deleting batch:', error);
      }
    }
  };

  const formatDate = (dateString: string) => {
    return dateString ? new Date(dateString).toLocaleDateString() : 'Not set';
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Batches</h1>
        <div className="flex gap-2">
          <Button onClick={fetchBatches} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/batches/add">Add New Batch</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Image</TableHead>
              <TableHead>Batch Name</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>End Date</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length > 0 ? (
              batches.map((item: any) => (
                <TableRow key={item.batch.id}>
                  <TableCell>
                    {item.batch.image ? (
                      <img
                        src={item.batch.image}
                        alt={item.batch.batchName}
                        className="w-16 h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{item.batch.batchName}</TableCell>
                  <TableCell>{item.course?.title || 'Unknown'}</TableCell>
                  <TableCell>{formatDate(item.batch.startDate)}</TableCell>
                  <TableCell>{formatDate(item.batch.endDate)}</TableCell>
                  <TableCell>{item.batch.capacity || 'Not set'}</TableCell>
                  <TableCell>{new Date(item.batch.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/batches/edit/${item.batch.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(item.batch.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No batches found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
