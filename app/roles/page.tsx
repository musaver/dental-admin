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

export default function RolesList() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/roles');
      const data = await res.json();
      setRoles(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this role?')) {
      try {
        await fetch(`/api/roles/${id}`, { method: 'DELETE' });
        setRoles(roles.filter((role: any) => role.id !== id));
      } catch (error) {
        console.error('Error deleting role:', error);
      }
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Admin Roles</h1>
        <div className="flex gap-2">
          <Button onClick={fetchRoles} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/roles/add">Add New Role</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Name</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.length > 0 ? (
              roles.map((role: any) => (
                <TableRow key={role.id}>
                  <TableCell className="font-medium">{role.name}</TableCell>
                  <TableCell>
                    {role.permissions && typeof role.permissions === 'string' 
                      ? JSON.parse(role.permissions).join(', ') 
                      : Array.isArray(role.permissions) 
                        ? role.permissions.join(', ') 
                        : 'None'}
                  </TableCell>
                  <TableCell>{new Date(role.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/roles/edit/${role.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(role.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No roles found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
