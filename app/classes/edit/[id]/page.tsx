'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import ClassForm, { ClassFormData } from '@/app/components/ClassForm';
import ClassAttendance from '@/app/components/ClassAttendance';

export default function EditClass() {
  const params = useParams();
  const classId = params.id as string;

  const [initialData, setInitialData] = useState<Partial<ClassFormData> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchClass = async () => {
      try {
        const res = await fetch(`/api/classes/${classId}`);
        if (!res.ok) throw new Error('Failed to fetch class');
        const data = await res.json();

        // Format scheduledAt for datetime-local without timezone conversion
        let formattedDateTime = '';
        if (data.scheduledAt) {
          const d = new Date(data.scheduledAt);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const hours = String(d.getHours()).padStart(2, '0');
          const minutes = String(d.getMinutes()).padStart(2, '0');
          formattedDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
        }

        setInitialData({
          title: data.title || '',
          courseId: data.courseId || '',
          batchId: data.batchId || '',
          description: data.description || '',
          scheduledAt: formattedDateTime,
          durationMinutes: data.durationMinutes ?? 60,
          zoomLink: data.zoomLink || '',
          zoomMeetingId: data.zoomMeetingId || '',
          zoomPasscode: data.zoomPasscode || '',
          recordingUrl: data.recordingUrl || '',
          status: data.status || 'scheduled',
          showToAllUsers: data.showToAllUsers !== undefined ? data.showToAllUsers : true,
        });
      } catch (err: any) {
        setError(err.message);
      }
    };

    fetchClass();
  }, [classId]);

  if (error) return <div className="p-4 text-destructive">{error}</div>;
  if (!initialData) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <>
      <ClassForm mode="edit" classId={classId} initialData={initialData} />
      <div className="p-4">
        <ClassAttendance classId={classId} />
      </div>
    </>
  );
}
