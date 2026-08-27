'use client';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

interface TaskCommentsProps {
  taskId: string;
}

export default function TaskComments({ taskId }: TaskCommentsProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      const data = await res.json();
      setComments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: reply }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add reply');
      }
      setReply('');
      await fetchComments();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const fmt = (d: string) => (d ? new Date(d).toLocaleString() : '');

  return (
    <div className="mt-8 border-t pt-6">
      <h2 className="text-xl font-semibold mb-4">Comments {loading ? '' : `(${comments.length})`}</h2>

      {loading ? (
        <div className="text-muted-foreground">Loading comments…</div>
      ) : comments.length === 0 ? (
        <p className="text-muted-foreground mb-4">No comments yet.</p>
      ) : (
        <div className="space-y-3 mb-4">
          {comments.map((c) => (
            <div
              key={c.id}
              className={`p-3 rounded-lg border ${c.authorType === 'admin' ? 'bg-accent' : 'bg-muted/50'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-foreground">{c.authorName || 'User'}</span>
                {c.authorType === 'admin' && (
                  <Badge>Admin</Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">{fmt(c.createdAt)}</span>
              </div>
              <p className="text-foreground whitespace-pre-line">{c.comment}</p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 max-w-2xl">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={3}
          placeholder="Write an admin reply…"
        />
        <div>
          <Button type="submit" disabled={submitting || !reply.trim()}>
            {submitting ? 'Posting…' : 'Post Reply'}
          </Button>
        </div>
      </form>
    </div>
  );
}
