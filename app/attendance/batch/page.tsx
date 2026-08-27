'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Batch {
  id: string;
  batchName: string;
  courseName: string;
}

export default function BatchSelectionPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/batches');
      const data = await response.json();
      
      if (response.ok) {
        // Extract batches from the response format
        const batchData = data.map((item: any) => ({
          id: item.batch.id,
          batchName: item.batch.batchName,
          courseName: item.course?.courseName || 'Unknown Course'
        }));
        setBatches(batchData);
      } else {
        console.error('Error fetching batches:', data.error);
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredBatches = batches.filter(batch => 
    batch.batchName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    batch.courseName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const navigateToBatchAttendance = (batchId: string, batchName: string) => {
    router.push(`/attendance/batch/${batchId}?name=${encodeURIComponent(batchName)}`);
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Select Batch</h1>
            <p className="text-muted-foreground mt-1">Choose a batch to view its attendance records</p>
          </div>
          <Button
            onClick={() => router.push('/attendance')}
            variant="secondary"
          >
            ← Back to All Attendance
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Input
            type="text"
            placeholder="Search batches by name or course..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-muted-foreground">Loading batches...</div>
        </div>
      ) : (
        <>
          <div className="mb-4 text-sm text-muted-foreground">
            {searchTerm ? `Found ${filteredBatches.length} batch(es) matching "${searchTerm}"` : `${batches.length} total batches`}
          </div>

          {filteredBatches.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <div className="text-muted-foreground text-lg">
                  {searchTerm ? 'No batches found matching your search' : 'No batches found'}
                </div>
                {searchTerm && (
                  <Button
                    variant="link"
                    onClick={() => setSearchTerm('')}
                    className="mt-3"
                  >
                    Clear search
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBatches.map((batch) => (
                <Card 
                  key={batch.id} 
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => navigateToBatchAttendance(batch.id, batch.batchName)}
                >
                  <CardContent>
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold tracking-tight mb-2">{batch.batchName}</h3>
                      <p className="text-sm text-muted-foreground">{batch.courseName}</p>
                    </div>
                    
                    <div className="flex justify-between items-center">
                      <div className="text-xs text-muted-foreground">
                        Batch ID: {batch.id.slice(0, 8)}...
                      </div>
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToBatchAttendance(batch.id, batch.batchName);
                        }}
                      >
                        View Attendance
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
} 