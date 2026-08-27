'use client';
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Batch {
  id: string;
  batchName: string;
}

interface ZoomLinkData {
  zoomLink: {
    id: number;
    url: string;
    batchId: string;
  };
  batch: {
    id: string;
    batchName: string;
  };
}

export default function ZoomLinkForm() {
  const [url, setUrl] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [allZoomLinks, setAllZoomLinks] = useState<ZoomLinkData[]>([]);
  const [currentZoomLink, setCurrentZoomLink] = useState<ZoomLinkData | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetchBatches();
    fetchAllZoomLinks();
  }, []);

  useEffect(() => {
    // Update current zoom link when batch selection changes
    if (selectedBatchId) {
      const zoomLinkForBatch = allZoomLinks.find(
        link => link.zoomLink.batchId === selectedBatchId
      );
      if (zoomLinkForBatch) {
        setCurrentZoomLink(zoomLinkForBatch);
        setUrl(zoomLinkForBatch.zoomLink.url);
        setIsEditing(true);
      } else {
        setCurrentZoomLink(null);
        setUrl('');
        setIsEditing(false);
      }
    } else {
      setCurrentZoomLink(null);
      setUrl('');
      setIsEditing(false);
    }
  }, [selectedBatchId, allZoomLinks]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/batches');
      const data = await response.json();
      // Extract batches from the response format
      const batchData = data.map((item: any) => ({
        id: item.batch.id,
        batchName: item.batch.batchName
      }));
      setBatches(batchData);
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllZoomLinks = async () => {
    try {
      const response = await fetch('/api/zoom-links');
      const data = await response.json();
      
      if (Array.isArray(data)) {
        setAllZoomLinks(data);
      } else {
        setAllZoomLinks([]);
      }
    } catch (error) {
      console.error('Error fetching zoom links:', error);
      setAllZoomLinks([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url || !selectedBatchId) {
      alert('Please fill in all fields');
      return;
    }

    setSubmitLoading(true);
    try {
      const response = await fetch('/api/zoom-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          batchId: selectedBatchId,
        }),
      });

      const result = await response.json();
      
      if (response.ok) {
        // Refresh the zoom links data
        await fetchAllZoomLinks();
      } else {
        alert(result.error || 'Failed to save zoom link');
      }
    } catch (error) {
      console.error('Error submitting zoom link:', error);
      alert('Error submitting zoom link');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!currentZoomLink || !selectedBatchId) {
      return;
    }

    if (!confirm('Are you sure you want to delete this zoom link?')) {
      return;
    }

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/zoom-links?batchId=${selectedBatchId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (response.ok) {
        // Refresh the zoom links data
        await fetchAllZoomLinks();
        // Reset current form state
        setUrl('');
        setCurrentZoomLink(null);
        setIsEditing(false);
      } else {
        alert(result.error || 'Failed to delete zoom link');
      }
    } catch (error) {
      console.error('Error deleting zoom link:', error);
      alert('Error deleting zoom link');
    } finally {
      setDeleteLoading(false);
    }
  };

  const getBatchZoomLinkStatus = (batchId: string) => {
    return allZoomLinks.find(link => link.zoomLink.batchId === batchId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {isEditing ? 'Edit Zoom Link' : 'Add Zoom Link'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            ℹ️ Each batch can have one zoom link. Select a batch to view, add, or edit its zoom link.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batch">Select Batch</Label>
            {loading ? (
              <div className="text-muted-foreground">Loading batches...</div>
            ) : (
              <select
                id="batch"
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                required
              >
                <option value="">Select a batch...</option>
                {batches.map((batch) => {
                  const hasZoomLink = getBatchZoomLinkStatus(batch.id);
                  return (
                    <option 
                      key={batch.id} 
                      value={batch.id}
                    >
                      {batch.batchName}
                      {hasZoomLink ? ' ✓ (Has zoom link)' : ' (No zoom link)'}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">Zoom URL</Label>
            <Input
              type="url"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://zoom.us/j/..."
              required
            />
          </div>

          {selectedBatchId && (
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="text-sm text-muted-foreground">
                {isEditing 
                  ? `This batch currently has a zoom link. You can update it or delete it.`
                  : `This batch doesn't have a zoom link yet. You can create one.`
                }
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={submitLoading || !selectedBatchId}
              className="flex-1"
            >
              {submitLoading ? 'Saving...' : (isEditing ? 'Update Zoom Link' : 'Add Zoom Link')}
            </Button>

            {isEditing && currentZoomLink && (
              <Button
                type="button"
                onClick={handleDelete}
                disabled={deleteLoading}
                variant="destructive"
              >
                {deleteLoading ? 'Deleting...' : 'Delete'}
              </Button>
            )}
          </div>
        </form>

        {/* Show existing zoom links summary */}
        {allZoomLinks.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Existing Zoom Links</h3>
            <div className="space-y-2">
              {allZoomLinks.map((linkData) => (
                <div key={linkData.zoomLink.id} className="rounded-md border bg-muted/50 p-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{linkData.batch.batchName}</p>
                      <p className="text-sm text-muted-foreground truncate">{linkData.zoomLink.url}</p>
                    </div>
                    <Button
                      onClick={() => setSelectedBatchId(linkData.zoomLink.batchId)}
                      variant="link"
                      size="sm"
                    >
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 