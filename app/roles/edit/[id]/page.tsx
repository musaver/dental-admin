'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const permissions = [
  { id: 'users_view', label: 'View Users' },
  { id: 'users_create', label: 'Create Users' },
  { id: 'users_edit', label: 'Edit Users' },
  { id: 'users_delete', label: 'Delete Users' },
  { id: 'courses_view', label: 'View Courses' },
  { id: 'courses_create', label: 'Create Courses' },
  { id: 'courses_edit', label: 'Edit Courses' },
  { id: 'courses_delete', label: 'Delete Courses' },
  { id: 'orders_view', label: 'View Orders' },
  { id: 'orders_create', label: 'Create Orders' },
  { id: 'orders_edit', label: 'Edit Orders' },
  { id: 'orders_delete', label: 'Delete Orders' },
  { id: 'admins_view', label: 'View Admins' },
  { id: 'admins_create', label: 'Create Admins' },
  { id: 'admins_edit', label: 'Edit Admins' },
  { id: 'admins_delete', label: 'Delete Admins' },
  { id: 'roles_view', label: 'View Roles' },
  { id: 'roles_create', label: 'Create Roles' },
  { id: 'roles_edit', label: 'Edit Roles' },
  { id: 'roles_delete', label: 'Delete Roles' },
  { id: 'logs_view', label: 'View Logs' },
];

export default function EditRole() {
  const router = useRouter();
  const params = useParams();
  const roleId = params.id as string;
  
  const [formData, setFormData] = useState({
    name: '',
    permissions: [] as string[],
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/roles/${roleId}`)
      .then(res => res.json())
      .then(data => {
        setFormData({
          name: data.name || '',
          permissions: JSON.parse(data.permissions || '[]'),
        });
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load role');
        setLoading(false);
      });
  }, [roleId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    
    if (type === 'checkbox') {
      const permissionId = name;
      if (checked) {
        setFormData(prev => ({
          ...prev,
          permissions: [...prev.permissions, permissionId]
        }));
      } else {
        setFormData(prev => ({
          ...prev,
          permissions: prev.permissions.filter(id => id !== permissionId)
        }));
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          permissions: JSON.stringify(formData.permissions),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update role');
      }

      router.push('/roles');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit Role</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Role Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="mb-6 space-y-2">
              <Label htmlFor="name">
                Role Name
              </Label>
              <Input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-medium mb-3">Permissions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {permissions.map((permission) => (
                  <div key={permission.id} className="flex items-center">
                    <input
                      type="checkbox"
                      id={permission.id}
                      name={permission.id}
                      onChange={handleChange}
                      checked={formData.permissions.includes(permission.id)}
                      className="mr-2"
                    />
                    <Label htmlFor={permission.id}>{permission.label}</Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                type="submit"
                disabled={submitting}
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </Button>
              <Button
                type="button"
                onClick={() => router.push('/roles')}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
