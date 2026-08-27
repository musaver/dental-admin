'use client';
import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ClassAttendance from '@/app/components/ClassAttendance';
import { Button } from '@/components/ui/button';

export default function ClassAttendanceDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const classId = params.classId as string;
  const [title, setTitle] = useState(searchParams.get('name') || '');

  useEffect(() => {
    if (!title) {
      fetch(`/api/classes/${classId}`)
        .then((res) => res.json())
        .then((data) => setTitle(data?.title || 'Class'))
        .catch(() => setTitle('Class'));
    }
  }, [classId, title]);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Attendance — {title || 'Class'}</h1>
        <div className="flex gap-2">
          <Button asChild variant="secondary">
            <Link href="/attendance/class">← All Classes</Link>
          </Button>
          <Button asChild>
            <Link href={`/classes/edit/${classId}`}>Edit Class</Link>
          </Button>
        </div>
      </div>
      <ClassAttendance classId={classId} />
    </div>
  );
}
