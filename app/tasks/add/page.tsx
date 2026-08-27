'use client';
import React from 'react';
import TaskForm from '@/app/components/TaskForm';

export default function AddTask() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">New Task</h1>
      <TaskForm mode="add" />
    </div>
  );
}
