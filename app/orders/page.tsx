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

export default function OrdersList() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/orders');
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this order?')) {
      try {
        await fetch(`/api/orders/${id}`, { method: 'DELETE' });
        setOrders(orders.filter((orderItem: any) => orderItem.order.id !== id));
      } catch (error) {
        console.error('Error deleting order:', error);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline' | 'success'> = {
      pending: 'secondary',
      completed: 'success',
      cancelled: 'destructive',
      processing: 'outline',
    };

    return (
      <Badge variant={statusVariants[status] || 'secondary'}>
        {status}
      </Badge>
    );
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <div className="flex gap-2">
          <Button onClick={fetchOrders} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/orders/add">Add New Order</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Order ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Course</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length > 0 ? (
              orders.map((orderItem: any) => (
                <TableRow key={orderItem.order.id}>
                  <TableCell className="font-medium">{orderItem.order.id.slice(0, 8)}</TableCell>
                  <TableCell>{orderItem.user?.name || 'Unknown'}</TableCell>
                  <TableCell>{orderItem.course?.title || 'Unknown'}</TableCell>
                  <TableCell>{orderItem.batch?.batchName || 'No Batch'}</TableCell>
                  <TableCell>{getStatusBadge(orderItem.order.status)}</TableCell>
                  <TableCell>{new Date(orderItem.order.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/orders/edit/${orderItem.order.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(orderItem.order.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No orders found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
