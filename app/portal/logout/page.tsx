'use client';

import { useEffect } from 'react';
import { signOut } from 'next-auth/react';

export default function PortalLogout() {
  useEffect(() => {
    signOut({ callbackUrl: '/portal/login' });
  }, []);
  return <p className="text-center text-muted-foreground pt-10">Signing out…</p>;
}
