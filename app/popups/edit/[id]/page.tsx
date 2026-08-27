'use client';
import React from 'react';
import { useParams } from 'next/navigation';
import PopupForm from '@/app/components/PopupForm';

export default function EditPopup() {
  const params = useParams();
  const popupId = params.id as string;

  return <PopupForm mode="edit" popupId={popupId} />;
}
