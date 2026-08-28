'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Messages for the codes lib/auth.ts throws from authorize().
 *
 * NextAuth surfaces a thrown Error's message as res.error, which is why
 * authorize() throws rather than returning null — returning null collapses
 * every failure into a generic "CredentialsSignin" and the user is told
 * nothing useful.
 *
 * "No account exists" is deliberately not among these: a wrong email and a
 * wrong password give the same message, so the form cannot be used to
 * enumerate who works here.
 */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  ACCOUNT_DISABLED: 'This account has been deactivated. Contact your clinic administrator.',
  ACCOUNT_LOCKED:
    'Too many failed attempts. Please wait 15 minutes before trying again.',
  WRONG_AUDIENCE: 'That account cannot sign in here.',
  CredentialsSignin: 'Incorrect email or password.',
};

function resolveError(code: string | null | undefined): string {
  if (!code) return '';
  return ERROR_MESSAGES[code] ?? 'Something went wrong. Please try again.';
}

export default function LoginForm({
  initialError,
  callbackUrl,
}: {
  initialError?: string;
  callbackUrl: string;
}) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Seeded from the query string so a mid-session deactivation explains itself.
  const [errorMsg, setErrorMsg] = useState(() => resolveError(initialError));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    const res = await signIn('staff-credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setErrorMsg(resolveError(res.error));
      return;
    }

    if (res?.ok) {
      // Only follow same-origin relative paths, never an absolute URL from the
      // query string.
      router.push(callbackUrl.startsWith('/') ? callbackUrl : '/');
      router.refresh();
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <p className="text-sm text-muted-foreground">Dental clinic administration</p>
      </CardHeader>
      <CardContent>
        {errorMsg && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive text-center"
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
