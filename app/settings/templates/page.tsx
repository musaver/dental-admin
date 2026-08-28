'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';

interface TemplateInfo {
  key: string;
  name: string;
  description: string;
  variables: string[];
  overridden: boolean;
}

/**
 * What the clinic's emails say. The defaults live in code; a database override
 * (message_templates) can reword any of them without a deploy — the editor for
 * that is a later-phase feature, and this page says so instead of pretending.
 */
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<TemplateInfo[]>('/api/settings/templates')
      .then(setTemplates)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load templates.'));
  }, []);

  return (
    <div className="p-4 max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Message templates</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          The emails the system sends. Sensible defaults are built in; rewording them from this
          screen is coming in a later phase.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {templates.map((template) => (
        <Card key={template.key}>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3 pb-2">
            <CardTitle className="text-base">{template.name}</CardTitle>
            {template.overridden && <Badge variant="secondary">Customised</Badge>}
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {template.description}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {template.variables.map((variable) => (
                <code key={variable} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {'{{'}{variable}{'}}'}
                </code>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to settings
      </Link>
    </div>
  );
}
