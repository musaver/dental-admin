'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Two-step portal sign-in: request a code, then enter it.
 *
 * The request step's response is identical whether or not the address has an
 * account — the SERVER enforces that; this form just renders the same message
 * either way.
 */
export default function PortalLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/portal/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Something went wrong.');
        return;
      }
      setNotice(body.message);
      setStep('code');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');

    const res = await signIn('patient-otp', { email, otp, redirect: false });
    setBusy(false);

    if (res?.error) {
      setError(
        res.error === 'ACCOUNT_LOCKED'
          ? 'Too many attempts. Please wait 15 minutes.'
          : 'That code is not right, or it has expired.'
      );
      return;
    }
    if (res?.ok) {
      router.push(next);
      router.refresh();
    }
  }

  return (
    <div className="flex justify-center pt-10">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <p className="text-sm text-muted-foreground">
            We&rsquo;ll email you a one-time code — no password needed.
          </p>
        </CardHeader>
        <CardContent>
          {error && (
            <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive text-center">
              {error}
            </div>
          )}
          {notice && step === 'code' && (
            <div className="mb-4 rounded-md border bg-muted/60 px-3 py-2 text-sm text-center">
              {notice}
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="portalEmail">Email</Label>
                <Input
                  id="portalEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="portalOtp">Six-digit code</Label>
                <Input
                  id="portalOtp"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                  className="text-center text-xl tracking-[0.5em]"
                />
              </div>
              <Button type="submit" disabled={busy || otp.length !== 6} className="w-full">
                {busy ? 'Checking…' : 'Sign in'}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep('email');
                  setOtp('');
                  setError('');
                }}
              >
                Use a different email
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
