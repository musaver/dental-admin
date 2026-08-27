'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import AnnouncementForm, { AnnouncementInitialData } from '@/app/components/AnnouncementForm';

export default function EditAnnouncement() {
  const params = useParams();
  const announcementId = params.id as string;

  const [initialData, setInitialData] = useState<Partial<AnnouncementInitialData> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/announcements/${announcementId}`);
        if (!res.ok) throw new Error('Failed to fetch announcement');
        const data = await res.json();

        setInitialData({
          title: data.title || '',
          description: data.description || '',
          url: data.url || '',
          imageUrl: data.imageUrl || '',
          courseId: data.courseId || '',
          batchId: data.batchId || '',
          status: data.status || 'published',
          recipientIds: Array.isArray(data.recipientIds) ? data.recipientIds : [],
        });
      } catch (err: any) {
        setError(err.message);
      }
    };
    fetchData();
  }, [announcementId]);

  if (error) return (
    <div className="p-4">
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">{error}</div>
    </div>
  );
  if (!initialData) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return <AnnouncementForm mode="edit" announcementId={announcementId} initialData={initialData} />;
}
