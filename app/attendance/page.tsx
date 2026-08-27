'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DateFilter from '../components/DateFilter';
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

export default function AttendancePage() {
  const router = useRouter();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchAttendance = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/attendance?${params.toString()}`);
      const data = await response.json();
      
      if (response.ok) {
        setAttendanceRecords(data);
      } else {
        console.error('Error fetching attendance:', data.error);
      }
    } catch (error) {
      console.error('Error fetching attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [startDate, endDate]);

  const handleClearFilter = () => {
    setStartDate('');
    setEndDate('');
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleTimeString();
  };

  const navigateToUserAttendance = (userId: string, userName: string) => {
    router.push(`/attendance/user/${userId}?name=${encodeURIComponent(userName)}`);
  };

  const navigateToBatchAttendance = (batchId: string, batchName: string) => {
    router.push(`/attendance/batch/${batchId}?name=${encodeURIComponent(batchName)}`);
  };

  // Group attendance by date for better visualization
  const groupedAttendance = attendanceRecords.reduce((acc, record) => {
    const date = formatDate(record.attendance.date);
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(record);
    return acc;
  }, {} as Record<string, AttendanceRecord[]>);

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Attendance Records</h1>
            <p className="text-muted-foreground mt-1">View and manage student attendance across all batches</p>
          </div>
          <Button
            onClick={fetchAttendance}
            disabled={loading}
            variant="outline"
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </Button>
        </div>
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
          <div className="mb-4 flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              Total Records: {attendanceRecords.length}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => router.push('/attendance/user')}
                size="sm"
              >
                View by User
              </Button>
              <Button
                onClick={() => router.push('/attendance/batch')}
                size="sm"
                variant="success"
              >
                View by Batch
              </Button>
              <Button
                onClick={() => router.push('/attendance/class')}
                size="sm"
              >
                View by Class
              </Button>
            </div>
          </div>

          {Object.keys(groupedAttendance).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground text-lg">No attendance records found</div>
                <p className="text-muted-foreground mt-2">
                  {startDate || endDate 
                    ? 'Try adjusting your date filter' 
                    : 'No attendance has been recorded yet'
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedAttendance)
                .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                .map(([date, records]) => (
                  <Card key={date} className="py-0 overflow-hidden">
                    <div className="bg-muted/40 px-6 py-3 border-b">
                      <h3 className="text-lg font-semibold tracking-tight">{date}</h3>
                      <p className="text-sm text-muted-foreground">{records.length} attendance record(s)</p>
                    </div>
                    
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Student</TableHead>
                            <TableHead>Batch</TableHead>
                            <TableHead>Time</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {records.map((record) => (
                            <TableRow key={record.attendance.id}>
                              <TableCell>
                                <div>
                                  <div className="text-sm font-medium">
                                    {record.user?.name || 'Unknown User'}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {record.user?.email || 'No email'}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  {record.batch?.batchName || 'Unknown Batch'}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  {formatTime(record.attendance.time)}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm">
                                <div className="flex gap-2 items-center">
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0"
                                    onClick={() => navigateToUserAttendance(record.user.id, record.user.name)}
                                  >
                                    View User
                                  </Button>
                                  <span className="text-muted-foreground">|</span>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    className="h-auto p-0"
                                    onClick={() => navigateToBatchAttendance(record.batch.id, record.batch.batchName)}
                                  >
                                    View Batch
                                  </Button>
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
        </>
      )}
    </div>
  );
} 