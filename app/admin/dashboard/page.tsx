'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Dashboard() {
  const router = useRouter();
  
  const cards = [
    { title: 'Users', count: '2', link: '/admin/users' },
    { title: 'Courses', count: '2', link: '/admin/courses' },
    { title: 'Orders', count: '1', link: '/admin/orders' },
    { title: 'Admin Users', count: '1', link: '/admin/admins' },
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold tracking-tight mb-6">Admin Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card
            key={card.title} 
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => router.push(card.link)}
          >
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tracking-tight">{card.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
} 