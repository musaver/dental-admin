'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ZoomLinkForm from './components/ZoomLinkForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DashboardStats {
  users: number;
  courses: number;
  orders: number;
  adminUsers: number;
  attendance: number;
  dateRange?: {
    startDate: string | null;
    endDate: string | null;
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    users: 0,
    courses: 0,
    orders: 0,
    adminUsers: 0,
    attendance: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Build query parameters
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const response = await fetch(`/api/dashboard/stats?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard statistics');
      }
      const data = await response.json();
      setStats(data);
    } catch (err: any) {
      console.error('Error fetching stats:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDateFilterChange = () => {
    fetchStats();
  };

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    // Fetch stats without date filters
    setTimeout(() => fetchStats(), 100);
  };

  const setPresetDates = (preset: string) => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    switch (preset) {
      case 'today':
        setStartDate(startOfToday.toISOString().split('T')[0]);
        setEndDate(startOfToday.toISOString().split('T')[0]);
        break;
      case 'week':
        const weekAgo = new Date(startOfToday);
        weekAgo.setDate(weekAgo.getDate() - 7);
        setStartDate(weekAgo.toISOString().split('T')[0]);
        setEndDate(startOfToday.toISOString().split('T')[0]);
        break;
      case 'month':
        const monthAgo = new Date(startOfToday);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        setStartDate(monthAgo.toISOString().split('T')[0]);
        setEndDate(startOfToday.toISOString().split('T')[0]);
        break;
    }
    setTimeout(() => fetchStats(), 100);
  };
  
  const cards = [
    { 
      title: 'Users', 
      count: loading ? '...' : stats.users.toString(), 
      link: '/users',
      icon: '👥'
    },
    { 
      title: 'Courses', 
      count: loading ? '...' : stats.courses.toString(), 
      link: '/courses',
      icon: '📚'
    },
    { 
      title: 'Orders', 
      count: loading ? '...' : stats.orders.toString(), 
      link: '/orders',
      icon: '🛒'
    },
    { 
      title: 'Admin Users', 
      count: loading ? '...' : stats.adminUsers.toString(), 
      link: '/admins',
      icon: '👨‍💼'
    },
    { 
      title: 'Attendance', 
      count: loading ? '...' : stats.attendance.toString(), 
      link: '/attendance',
      icon: '📅'
    },
  ];

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <Button onClick={fetchStats} disabled={loading} variant="outline">
          {loading ? 'Refreshing...' : '🔄 Refresh'}
        </Button>
      </div>

      {/* Date Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">📅 Filter by Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button onClick={handleDateFilterChange} className="w-full">
                Apply Filter
              </Button>
            </div>

            <div className="flex items-end">
              <Button onClick={clearFilters} variant="secondary" className="w-full">
                Clear Filters
              </Button>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setPresetDates('today')} variant="outline" size="sm" className="rounded-full">
              Today
            </Button>
            <Button onClick={() => setPresetDates('week')} variant="outline" size="sm" className="rounded-full">
              Last 7 Days
            </Button>
            <Button onClick={() => setPresetDates('month')} variant="outline" size="sm" className="rounded-full">
              Last 30 Days
            </Button>
          </div>

          {/* Active Filter Display */}
          {(startDate || endDate) && (
            <div className="mt-4 rounded-lg border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Active Filter:</span>
                {startDate && ` From ${new Date(startDate).toLocaleDateString()}`}
                {endDate && ` To ${new Date(endDate).toLocaleDateString()}`}
                {!startDate && endDate && ` Up to ${new Date(endDate).toLocaleDateString()}`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      
      {error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
          <div className="flex items-center">
            <span className="mr-2">⚠️</span>
            Error loading dashboard statistics: {error}
          </div>
        </div>
      )}
      
      {/* Dashboard Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        {cards.map((card) => (
          <Card
            key={card.title}
            className="cursor-pointer gap-0 py-0 transition-shadow hover:shadow-md"
            onClick={() => router.push(card.link)}
          >
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-sm font-medium text-muted-foreground">{card.title}</h2>
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-lg">{card.icon}</span>
            </div>
            <div className="p-6">
              <p className="mb-1 text-4xl font-bold tracking-tight">{card.count}</p>
              <p className="text-sm text-muted-foreground">Total records</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Zoom Link Section */}
      <div className="max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight mb-4">🔗 Zoom Link Management</h2>
        <ZoomLinkForm />
      </div>
    </div>
  );
}
