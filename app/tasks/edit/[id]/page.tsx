'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import TaskForm, { TaskFormData } from '@/app/components/TaskForm';
import TaskComments from '@/app/components/TaskComments';

export default function EditTask() {
  const params = useParams();
  const taskId = params.id as string;

  const [initialData, setInitialData] = useState<Partial<TaskFormData> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchTask = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        if (!res.ok) throw new Error('Failed to fetch task');
        const data = await res.json();

        let due = '';
        if (data.dueDate) {
          const d = new Date(data.dueDate);
          const p = (n: number) => String(n).padStart(2, '0');
          due = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
        }

        setInitialData({
          title: data.title || '',
          description: data.description || '',
          classId: data.classId || '',
          dueDate: due,
          status: data.status || 'open',
          priority: data.priority || 'normal',
          attachmentUrl: data.attachmentUrl || '',
        });
      } catch (err: any) {
        setError(err.message);
      }
    };
    fetchTask();
  }, [taskId]);

  if (error) return <div className="p-4 text-destructive">{error}</div>;
  if (!initialData) return <div className="p-4 text-muted-foreground">Loading...</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Edit Task</h1>
      <TaskForm mode="edit" taskId={taskId} initialData={initialData} />
      <TaskComments taskId={taskId} />
    </div>
  );
}
