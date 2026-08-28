'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiError } from '@/lib/api-client';

/**
 * Landing page for the invitation link.
 *
 * Middleware lets this page through without a session so the link can be
 * opened cold; if the visitor is not signed in yet, they are sent through the
 * OTP flow and return here, and the token then completes the link.
 */
export default function PortalActivate({ token }: { token: string }) {
  const [state, setState] = useState<'working' | 'done' | 'error' | 'signin'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setMessage('This link is missing its token. Use the full link from your email.');
      return;
    }

    api
      .post<{ linked: boolean; mrn: string }>('/api/portal/activate', { token })
      .then((res) => {
        setState('done');
        setMessage(`Your record (${res.mrn}) is now linked to this account.`);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setState('signin');
          return;
        }
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
  }, [token]);

  return (
    <div className="flex justify-center pt-10">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-xl">Portal activation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'working' && <p className="text-sm text-muted-foreground">Linking your record…</p>}

          {state === 'signin' && (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in first with the email address the clinic has on file, then open this link
                again.
              </p>
              <Button asChild className="w-full">
                <Link href={`/portal/login?next=${encodeURIComponent(`/portal/activate?token=${token}`)}`}>
                  Sign in
                </Link>
              </Button>
            </>
          )}

          {state === 'done' && (
            <>
              <p className="text-sm">{message}</p>
              <Button asChild className="w-full">
                <Link href="/portal">See your records</Link>
              </Button>
            </>
          )}

          {state === 'error' && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
