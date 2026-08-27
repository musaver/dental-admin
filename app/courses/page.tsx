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

export default function CoursesList() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/courses');
      const data = await res.json();
      setCourses(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this course?')) {
      try {
        await fetch(`/api/courses/${id}`, { method: 'DELETE' });
        setCourses(courses.filter((course: any) => course.id !== id));
      } catch (error) {
        console.error('Error deleting course:', error);
      }
    }
  };

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Courses</h1>
        <div className="flex gap-2">
          <Button onClick={fetchCourses} disabled={loading} variant="outline">
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
          <Button asChild variant="success">
            <Link href="/courses/add">Add New Course</Link>
          </Button>
        </div>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Image</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.length > 0 ? (
              courses.map((course: any) => (
                <TableRow key={course.id}>
                  <TableCell>
                    {course.image ? (
                      <img
                        src={course.image}
                        alt={course.title}
                        className="w-16 h-16 object-cover rounded"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{course.title}</TableCell>
                  <TableCell>Rs.{(course.price).toFixed(2)}</TableCell>
                  <TableCell>{new Date(course.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button asChild size="sm" variant="success">
                        <Link href={`/courses/edit/${course.id}`}>Edit</Link>
                      </Button>
                      <Button onClick={() => handleDelete(course.id)} size="sm" variant="destructive">
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No courses found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
