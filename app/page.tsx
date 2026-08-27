'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Placeholder dashboard.
 *
 * The real widget-registry dashboard (role presets, branch scoping, batched
 * /api/dashboard fetch, SVG charts) is built in a later phase. This exists so
 * the app has a working landing page during the dental conversion.
 */
export default function Dashboard() {
  const sections = [
    { name: 'Staff', href: '/admins', description: 'Manage staff accounts and their roles' },
    { name: 'Roles', href: '/roles', description: 'Permission sets for each kind of staff member' },
    { name: 'Portal accounts', href: '/users', description: 'Patient-portal login accounts' },
  ];

  return (
    <div className="p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dental clinic administration
        </p>
      </div>

      <div className="mb-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        The clinical modules — patients, odontogram, appointments, treatment plans and
        billing — are being built. The sections below are available now.
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="block">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="text-base">{section.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{section.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
