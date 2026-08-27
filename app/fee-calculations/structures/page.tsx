'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatPKR } from '@/lib/money';
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

export default function FeeStructuresList() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fee-structures');
      setRows(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Delete this fee structure (and its components)?')) {
      await fetch(`/api/fee-structures/${id}`, { method: 'DELETE' });
      setRows(rows.filter((r) => r.structure.id !== id));
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Fee Structures</h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/fee-calculations">← Back</Link>
          </Button>
          <Button asChild variant="success">
            <Link href="/fee-calculations/structures/add">Add Fee Structure</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Course</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Cycle</TableHead>
              <TableHead>Base Amount</TableHead>
              <TableHead>Due Day</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((r) => (
                <TableRow key={r.structure.id}>
                  <TableCell>{r.course?.title || 'Unknown'}</TableCell>
                  <TableCell>{r.structure.name}</TableCell>
                  <TableCell>{r.structure.billingCycle}</TableCell>
                  <TableCell>{formatPKR(r.structure.baseAmount)}</TableCell>
                  <TableCell>{r.structure.dueDayOfMonth || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={r.structure.isActive ? 'success' : 'secondary'}>
                      {r.structure.isActive ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild variant="success" size="sm">
                        <Link href={`/fee-calculations/structures/edit/${r.structure.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(r.structure.id)} variant="destructive" size="sm">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No fee structures found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
