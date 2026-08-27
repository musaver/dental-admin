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
  uniqueStudents: number;
  attendanceByStudent: Record<string, { count: number; name: string; email: string }>;
  attendanceByDate: Record<string, number>;
}

export default function BatchAttendancePage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const batchId = params.batchId as string;
  const batchName = searchParams.get('name') || 'Unknown Batch';

  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [stats, setStats] = useState<AttendanceStats>({
    totalAttendance: 0,
    uniqueStudents: 0,
    attendanceByStudent: {},
    attendanceByDate: {}
  });

  useEffect(() => {
    if (batchId) {
      fetchBatchAttendance();
    }
  }, [batchId, startDate, endDate]);

  useEffect(() => {
    calculateStats();
  }, [attendanceRecords]);

  const fetchBatchAttendance = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('batchId', batchId);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/attendance?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setAttendanceRecords(data);
      } else {
        console.error('Error fetching batch attendance:', data.error);
      }
    } catch (error) {
      console.error('Error fetching batch attendance:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = () => {
    const uniqueStudents = new Set(attendanceRecords.map(record => record.user?.id).filter(Boolean)).size;

    const attendanceByStudent = attendanceRecords.reduce((acc, record) => {
      const userId = record.user?.id || 'unknown';
      if (!acc[userId]) {
        acc[userId] = {
          count: 0,
          name: record.user?.name || 'Unknown Student',
          email: record.user?.email || 'No Email'
        };
      }
      acc[userId].count += 1;
      return acc;
    }, {} as Record<string, { count: number; name: string; email: string }>);

    const attendanceByDate = attendanceRecords.reduce((acc, record) => {
      const date = new Date(record.attendance.date).toLocaleDateString();
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    setStats({
      totalAttendance: attendanceRecords.length,
      uniqueStudents,
      attendanceByStudent,
      attendanceByDate
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

  const navigateToUserAttendance = (userId: string, userName: string) => {
    router.push(`/attendance/user/${userId}?name=${encodeURIComponent(userName)}`);
  };

  // Group attendance by date for better visualization
  const groupedByDate = attendanceRecords.reduce((acc, record) => {
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Attendance for {batchName}
            </h1>
            <p className="text-muted-foreground mt-1">View student attendance for this batch</p>
          </div>
          <Button variant="secondary" onClick={() => router.push('/attendance')}>
            ← Back to All Attendance
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.totalAttendance}</div>
            <div className="text-sm text-muted-foreground">Total Attendance</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.uniqueStudents}</div>
            <div className="text-sm text-muted-foreground">Unique Students</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {Object.keys(stats.attendanceByDate).length}
            </div>
            <div className="text-sm text-muted-foreground">Session Days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {stats.uniqueStudents > 0
                ? Math.round((stats.totalAttendance / stats.uniqueStudents) * 100) / 100
                : 0
              }
            </div>
            <div className="text-sm text-muted-foreground">Avg per Student</div>
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
          {Object.keys(groupedByDate).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground text-lg">No attendance records found</div>
                <p className="text-muted-foreground mt-2">
                  {startDate || endDate
                    ? 'Try adjusting your date filter'
                    : 'No students have attended this batch yet'
                  }
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Attendance by Date */}
              <Card className="py-0 overflow-hidden">
                <div className="bg-muted/40 px-6 py-3 border-b">
                  <h3 className="text-lg font-semibold tracking-tight">Attendance by Session</h3>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Date</TableHead>
                        <TableHead>Students Present</TableHead>
                        <TableHead>Day of Week</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(groupedByDate)
                        .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                        .map(([date, records]) => (
                          <TableRow key={date}>
                            <TableCell>
                              <div className="text-sm font-medium">{date}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">{records.length}</div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-muted-foreground">
                                {new Date(records[0].attendance.date).toLocaleDateString('en-US', { weekday: 'long' })}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              <details className="cursor-pointer">
                                <summary className="text-primary hover:underline">View Students</summary>
                                <div className="mt-2 p-2 bg-muted/40 rounded">
                                  {records.map((record) => (
                                    <div key={record.attendance.id} className="flex justify-between items-center py-1">
                                      <span className="text-sm">{record.user?.name || 'Unknown Student'}</span>
                                      <span className="text-xs text-muted-foreground">{formatTime(record.attendance.time)}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {/* Student Attendance Summary */}
              {Object.keys(stats.attendanceByStudent).length > 0 && (
                <Card className="py-0 overflow-hidden">
                  <div className="bg-muted/40 px-6 py-3 border-b">
                    <h3 className="text-lg font-semibold tracking-tight">Student Attendance Summary</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Student</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Sessions Attended</TableHead>
                          <TableHead>Attendance Rate</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(stats.attendanceByStudent)
                          .sort(([, a], [, b]) => b.count - a.count)
                          .map(([userId, studentData]) => {
                            const attendanceRate = Math.round((studentData.count / Object.keys(stats.attendanceByDate).length) * 100);
                            return (
                              <TableRow key={userId}>
                                <TableCell className="font-medium">{studentData.name}</TableCell>
                                <TableCell className="text-muted-foreground">{studentData.email}</TableCell>
                                <TableCell className="font-bold text-foreground">{studentData.count}</TableCell>
                                <TableCell>
                                  <div className={`text-sm font-medium ${attendanceRate >= 80 ? 'text-emerald-600' :
                                      attendanceRate >= 60 ? 'text-amber-600' : 'text-destructive'
                                    }`}>
                                    {attendanceRate}%
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Button
                                    variant="link"
                                    size="sm"
                                    onClick={() => navigateToUserAttendance(userId, studentData.name)}
                                  >
                                    View Details
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
} 