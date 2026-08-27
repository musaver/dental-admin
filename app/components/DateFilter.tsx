'use client';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DateFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onClearFilter: () => void;
}

export default function DateFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClearFilter
}: DateFilterProps) {
  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const setToday = () => {
    const today = formatDateForInput(new Date());
    onStartDateChange(today);
    onEndDateChange(today);
  };

  const setThisWeek = () => {
    const today = new Date();
    const firstDayOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const lastDayOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 6));
    
    onStartDateChange(formatDateForInput(firstDayOfWeek));
    onEndDateChange(formatDateForInput(lastDayOfWeek));
  };

  const setThisMonth = () => {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    onStartDateChange(formatDateForInput(firstDayOfMonth));
    onEndDateChange(formatDateForInput(lastDayOfMonth));
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Date Filter</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="startDate">Start Date</Label>
            <Input
              type="date"
              id="startDate"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="endDate">End Date</Label>
            <Input
              type="date"
              id="endDate"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button onClick={onClearFilter} variant="secondary" className="w-full">
              Clear Filter
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={setToday} variant="outline" size="sm" className="rounded-full">
            Today
          </Button>
          <Button onClick={setThisWeek} variant="outline" size="sm" className="rounded-full">
            This Week
          </Button>
          <Button onClick={setThisMonth} variant="outline" size="sm" className="rounded-full">
            This Month
          </Button>
        </div>

        {(startDate || endDate) && (
          <div className="mt-4 rounded-lg border bg-muted/50 p-3">
            <p className="text-sm text-muted-foreground">
              {startDate && endDate
                ? `Showing records from ${startDate} to ${endDate}`
                : startDate
                  ? `Showing records from ${startDate} onwards`
                  : `Showing records up to ${endDate}`
              }
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 