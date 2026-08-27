'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RecipientPickerProps {
  // Controlled selection: set of selected userIds
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  // Course/batch filter lifted to the parent so it can be stored on the announcement
  courseId: string;
  batchId: string;
  onCourseChange: (courseId: string) => void;
  onBatchChange: (batchId: string) => void;
  // When true, default-selects everyone the first time the full list loads
  autoSelectAllOnFirstLoad?: boolean;
}

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
}

export default function RecipientPicker({
  selected,
  onChange,
  courseId,
  batchId,
  onCourseChange,
  onBatchChange,
  autoSelectAllOnFirstLoad = false,
}: RecipientPickerProps) {
  const [courses, setCourses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [allMatchingIds, setAllMatchingIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [didAutoSelect, setDidAutoSelect] = useState(false);

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Load course/batch options once
  useEffect(() => {
    Promise.all([
      fetch('/api/courses').then((r) => r.json()),
      fetch('/api/batches').then((r) => r.json()),
    ])
      .then(([coursesData, batchesData]) => {
        setCourses(Array.isArray(coursesData) ? coursesData : []);
        setBatches(Array.isArray(batchesData) ? batchesData : []);
      })
      .catch((err) => console.error('Failed to load courses/batches', err));
  }, []);

  // Debounce the search box
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever the filter/search changes
  useEffect(() => {
    setPage(1);
  }, [courseId, batchId, debouncedSearch]);

  const fetchRecipients = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (courseId) qs.set('courseId', courseId);
      if (batchId) qs.set('batchId', batchId);
      if (debouncedSearch) qs.set('search', debouncedSearch);

      const res = await fetch(`/api/announcements/recipients?${qs.toString()}`);
      const data = await res.json();
      setUsers(data.users || []);
      setTotal(data.total || 0);
      setAllMatchingIds(data.allMatchingIds || []);

      // First-load default: select everyone (only when no filter/search active)
      if (
        autoSelectAllOnFirstLoad &&
        !didAutoSelect &&
        !courseId &&
        !batchId &&
        !debouncedSearch
      ) {
        onChange(new Set<string>(data.allMatchingIds || []));
        setDidAutoSelect(true);
      }
    } catch (err) {
      console.error('Failed to fetch recipients', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, courseId, batchId, debouncedSearch]);

  useEffect(() => {
    fetchRecipients();
  }, [fetchRecipients]);

  const filteredBatches = courseId
    ? batches.filter((item: any) => item.batch.courseId === courseId)
    : batches;

  const toggleUser = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selected);
    allMatchingIds.forEach((id) => next.add(id));
    onChange(next);
  };

  const deselectAllFiltered = () => {
    const next = new Set(selected);
    allMatchingIds.forEach((id) => next.delete(id));
    onChange(next);
  };

  const matchingSelectedCount = allMatchingIds.filter((id) => selected.has(id)).length;

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="border rounded-lg p-4 bg-muted/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground">Recipients</h3>
        <span className="text-sm text-muted-foreground">{selected.size} selected (total)</span>
      </div>

      {/* Course / Batch filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="space-y-1.5">
          <Label>Filter by Course</Label>
          <select
            value={courseId}
            onChange={(e) => {
              onCourseChange(e.target.value);
              onBatchChange('');
            }}
            className={selectClass}
          >
            <option value="">All courses</option>
            {courses.map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Filter by Batch</Label>
          <select
            value={batchId}
            onChange={(e) => onBatchChange(e.target.value)}
            className={selectClass}
          >
            <option value="">All batches</option>
            {filteredBatches.map((item: any) => (
              <option key={item.batch.id} value={item.batch.id}>
                {item.batch.batchName}
                {item.course?.title ? ` — ${item.course.title}` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search + bulk actions */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="flex-1"
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={selectAllFiltered}
            className="whitespace-nowrap"
          >
            Select all{courseId || batchId || debouncedSearch ? ' (filtered)' : ''}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={deselectAllFiltered}
            className="whitespace-nowrap"
          >
            Deselect all{courseId || batchId || debouncedSearch ? ' (filtered)' : ''}
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        {loading ? 'Loading…' : `${matchingSelectedCount} of ${total} shown users selected`}
      </div>

      {/* User list */}
      <div className="bg-background border rounded-lg divide-y max-h-80 overflow-y-auto">
        {users.length === 0 && !loading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">No users match this filter.</div>
        ) : (
          users.map((u) => (
            <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(u.id)}
                onChange={() => toggleUser(u.id)}
                className="accent-primary"
              />
              <span className="flex-1">
                <span className="font-medium text-foreground">{u.name || 'Unnamed user'}</span>
                <span className="text-muted-foreground text-sm ml-2">{u.email}</span>
              </span>
            </label>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
        >
          ← Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
