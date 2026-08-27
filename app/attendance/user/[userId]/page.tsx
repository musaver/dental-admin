'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import DateFilter from '../../../components/DateFilter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface AttendanceRecord {
  attendance: {
    id: string;
    userId: string;
    batchId: string;
    date: string;
    time: string;
    createdAt: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
  batch: {
    id: string;
    batchName: string;
  };
}

interface AttendanceStats {
  totalAttendance: number;
  uniqueBatches: number;
  attendanceByBatch: Record<string, number>;
}

export default function UserAttendancePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const userId = params.userId as string;
  const userName = searchParams.get('name') || 'Unknown User';
  
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState<AttendanceStats>({
    totalAttendance: 0,
    uniqueBatches: 0,
    attendanceByBatch: {}
  });

  useEffect(() => {
    if (userId) {
      fetchUserAttendance();
    }
  }, [userId, startDate, endDate]);

  useEffect(() => {
    calculateStats();
  }, [attendanceRecords]);

  const fetchUserAttendance = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('userId', userId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/attendance?${params.toString()}`);
      const data = await response.json();
      
      if (response.ok) {
        setAttendanceRecords(data);
      } else {
        console.error('Error fetching user attendance:', data.error);
      }
    } catch (error) {
      console.error('Error fetching user attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = () => {
    const uniqueBatches = new Set(attendanceRecords.map(record => record.batch.id)).size;
    const attendanceByBatch = attendanceRecords.reduce((acc, record) => {
      const batchName = record.batch.batchName;
      acc[batchName] = (acc[batchName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    setStats({
      totalAttendance: attendanceRecords.length,
      uniqueBatches,
      attendanceByBatch
    });
  };

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleTimeString();
  };

  const navigateToBatchAttendance = (batchId: string, batchName: string) => {
    router.push(`/attendance/batch/${batchId}?name=${encodeURIComponent(batchName)}`);
  };

  // Group attendance by batch for better visualization
  const groupedByBatch = attendanceRecords.reduce((acc, record) => {
    const batchName = record.batch.batchName;
    if (!acc[batchName]) {
      acc[batchName] = [];
    }
    acc[batchName].push(record);
    return acc;
  }, {} as Record<string, AttendanceRecord[]>);

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Attendance for {userName}
            </h1>
            <p className="text-muted-foreground mt-1">View attendance history across all batches</p>
          </div>
          <Button
            onClick={() => router.push('/attendance')}
            variant="secondary"
          >
            ← Back to All Attendance
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.totalAttendance}</div>
            <div className="text-sm text-muted-foreground">Total Attendance</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.uniqueBatches}</div>
            <div className="text-sm text-muted-foreground">Unique Batches</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {attendanceRecords.length > 0 
                ? Math.round((attendanceRecords.length / 30) * 100) / 100 // Rough monthly average
                : 0
              }
            </div>
            <div className="text-sm text-muted-foreground">Avg per Month</div>
          </CardContent>
        </Card>
      </div>

      <DateFilter
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onClearFilter={handleClearFilter}
      />

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-muted-foreground">Loading attendance records...</div>
        </div>
      ) : (
        <>
          {Object.keys(groupedByBatch).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground text-lg">No attendance records found</div>
                <p className="text-muted-foreground mt-2">
                  {startDate || endDate 
                    ? 'Try adjusting your date filter' 
                    : 'This user has no attendance records yet'
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedByBatch)
                .sort(([, a], [, b]) => b.length - a.length) // Sort by attendance count
                .map(([batchName, records]) => (
                  <Card key={batchName} className="py-0 overflow-hidden">
                    <div className="bg-muted/40 px-6 py-3 border-b">
                      <div className="flex justify-between items-center">
                        <div>
                          <h3 className="text-lg font-semibold tracking-tight">{batchName}</h3>
                          <p className="text-sm text-muted-foreground">{records.length} attendance record(s)</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => navigateToBatchAttendance(records[0].batch.id, batchName)}
                        >
                          View Batch Details
                        </Button>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Date</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Day of Week</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {records
                            .sort((a, b) => new Date(b.attendance.date).getTime() - new Date(a.attendance.date).getTime())
                            .map((record) => (
                              <TableRow key={record.attendance.id}>
                                <TableCell>
                                  <div className="text-sm font-medium">
                                    {formatDate(record.attendance.date)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">
                                    {formatTime(record.attendance.time)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm text-muted-foreground">
                                    {new Date(record.attendance.date).toLocaleDateString('en-US', { weekday: 'long' })}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                ))}
            </div>
          )}

          {/* Attendance Summary by Batch */}
          {Object.keys(stats.attendanceByBatch).length > 0 && (
            <Card className="mt-8">
              <CardContent>
                <h3 className="text-lg font-semibold tracking-tight mb-4">Attendance Summary by Batch</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.entries(stats.attendanceByBatch).map(([batchName, count]) => (
                    <div key={batchName} className="p-3 bg-muted/40 rounded-md">
                      <div className="font-medium">{batchName}</div>
                      <div className="text-2xl font-bold text-foreground">{count}</div>
                      <div className="text-sm text-muted-foreground">sessions attended</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
} 