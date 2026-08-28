import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Patient Portal',
  description: 'Your appointments, treatment plans and invoices',
};

/**
 * The portal shell: deliberately minimal, and entirely separate from the
 * staff chrome. ClientLayout already returns bare children for /portal, so a
 * patient can never see the admin sidebar; this adds the patient-facing frame.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-semibold">Patient Portal</span>
          <a href="/portal/logout" className="text-sm text-muted-foreground hover:text-foreground">
            Sign out
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
