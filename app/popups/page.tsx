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

export default function PopupsList() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/popups');
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
    if (confirm('Are you sure you want to delete this popup?')) {
      try {
        await fetch(`/api/popups/${id}`, { method: 'DELETE' });
        setItems(items.filter((item) => item.id !== id));
      } catch (error) {
        console.error('Error deleting popup:', error);
      }
    }
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Popups</h1>
        <div className="flex gap-2">
          <Button onClick={fetchItems} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/popups/add">Add Popup</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Preview</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Images</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length > 0 ? (
              items.map((item) => {
                const images: string[] = Array.isArray(item.images) ? item.images : [];
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      {images.length > 0 ? (
                        <img
                          src={images[0]}
                          alt={item.title}
                          className="w-12 h-12 object-cover rounded border"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{item.title}</TableCell>
                    <TableCell>{images.length}</TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? 'success' : 'secondary'}>
                        {item.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(item.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button asChild size="sm" variant="success">
                          <Link href={`/popups/edit/${item.id}`}>Edit</Link>
                        </Button>
                        <Button onClick={() => handleDelete(item.id)} size="sm" variant="destructive">
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No popups found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
