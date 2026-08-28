'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LogOutIcon, MenuIcon } from 'lucide-react';
import { isActiveNavItem, visibleNavigation, type NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * The staff application shell.
 *
 * Renders nothing but its children for the login page and for the patient
 * portal, which has its own layout — a patient must never see the admin
 * sidebar.
 */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const permissions = useMemo(
    () => (session?.user?.permissions as string[] | undefined) ?? [],
    [session]
  );
  const sections = useMemo(() => visibleNavigation(permissions), [permissions]);

  // The portal has its own shell; bail out before rendering any admin chrome.
  if (pathname.startsWith('/portal')) return <>{children}</>;

  /*
   * Render the page during session resolution rather than returning null.
   *
   * useSession reports 'loading' on the server and on first client paint, so
   * returning null here meant EVERY page shipped an empty document and only
   * appeared after hydration — a blank flash on every navigation, and nothing
   * at all for a crawler or a slow connection.
   *
   * The sidebar simply arrives once the session resolves; the page itself
   * never waits for it.
   */
  if (status === 'loading' || !session) return <>{children}</>;

  const user = session.user;
  const branchLabel = user.branchId ? null : 'All branches';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 p-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <button
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={sidebarOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <MenuIcon className="size-[18px]" aria-hidden />
        </button>
        <span className="font-semibold">Dental Clinic</span>
      </div>

      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-40 w-64 transform bg-sidebar text-sidebar-foreground transition-transform duration-200 overflow-y-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent
          sections={sections}
          pathname={pathname}
          user={user}
          branchLabel={branchLabel}
          onNavigate={() => setSidebarOpen(false)}
        />
      </aside>

      {/* Desktop rail */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border overflow-y-auto">
        <SidebarContent
          sections={sections}
          pathname={pathname}
          user={user}
          branchLabel={branchLabel}
        />
      </aside>

      <main className="lg:pl-64 pt-16 lg:pt-0">{children}</main>
    </div>
  );
}

function SidebarContent({
  sections,
  pathname,
  user,
  branchLabel,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  user: { name?: string | null; email?: string | null; roleName?: string | null };
  branchLabel: string | null;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-5 border-b border-sidebar-border">
        <div className="font-semibold tracking-tight">Dental Clinic</div>
        {branchLabel && (
          <div className="mt-0.5 text-xs text-muted-foreground">{branchLabel}</div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-4">
        {sections.map((section) => (
          <div key={section.key}>
            {section.label && (
              <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </div>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActiveNavItem(item, pathname);
                /*
                 * The icon is a component, not a string, so it has to be
                 * bound to a capitalised local before JSX will render it.
                 */
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 transition-colors',
                        active
                          ? 'text-sidebar-accent-foreground'
                          : 'text-muted-foreground group-hover:text-sidebar-accent-foreground'
                      )}
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="truncate text-sm font-medium">{user.name || user.email}</div>
        {user.roleName && (
          <div className="truncate text-xs text-muted-foreground">{user.roleName}</div>
        )}
        <Link
          href="/logout"
          onClick={onNavigate}
          className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <LogOutIcon aria-hidden className="size-3.5 shrink-0" /> Sign out
        </Link>
      </div>
    </div>
  );
}
