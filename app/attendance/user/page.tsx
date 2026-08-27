'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface User {
  id: string;
  name: string;
  email: string;
}

export default function UserSelectionPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      
      if (response.ok) {
        // Extract users from the response format
        const userData = data.map((item: any) => ({
          id: item.user.id,
          name: item.user.name,
          email: item.user.email
        }));
        setUsers(userData);
      } else {
        console.error('Error fetching users:', data.error);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const navigateToUserAttendance = (userId: string, userName: string) => {
    router.push(`/attendance/user/${userId}?name=${encodeURIComponent(userName)}`);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Select User</h1>
            <p className="text-muted-foreground mt-1">Choose a user to view their attendance records</p>
          </div>
          <Button variant="secondary" onClick={() => router.push('/attendance')}>
            ← Back to All Attendance
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Input
            type="text"
            placeholder="Search users by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-muted-foreground">Loading users...</div>
        </div>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted-foreground">
            {searchTerm ? `Found ${filteredUsers.length} user(s) matching "${searchTerm}"` : `${users.length} total users`}
          </div>

          {filteredUsers.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="text-muted-foreground text-lg">
                {searchTerm ? 'No users found matching your search' : 'No users found'}
              </div>
              {searchTerm && (
                <div>
                  <Button variant="link" onClick={() => setSearchTerm('')} className="mt-3">
                    Clear search
                  </Button>
                </div>
              )}
            </Card>
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer"
                      onClick={() => navigateToUserAttendance(user.id, user.name)}
                    >
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToUserAttendance(user.id, user.name);
                          }}
                        >
                          View Attendance
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
} 