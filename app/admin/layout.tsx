'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  const navigation = [
    { name: 'Dashboard', href: '/admin/dashboard', icon: '📊' },
    { name: 'Users', href: '/admin/users', icon: '👥' },
    { name: 'Courses', href: '/admin/courses', icon: '📚' },
    { name: 'Batches', href: '/batches', icon: '📦' },
    { name: 'Recordings', href: '/recordings', icon: '🎥' },
    { name: 'Orders', href: '/admin/orders', icon: '🛒' },
    { name: 'Admin Users', href: '/admin/admins', icon: '👮' },
    { name: 'Admin Roles', href: '/admin/roles', icon: '🔐' },
    { name: 'Admin Logs', href: '/admin/logs', icon: '📋' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 p-4 bg-sidebar text-sidebar-foreground border-b border-sidebar-border">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <span className="sr-only">Open sidebar</span>
          {sidebarOpen ? '✕' : '☰'}
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Admin Panel</h1>
      </div>
      
      {/* Sidebar for mobile */}
      <div className={`fixed inset-0 z-30 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebarOpen(false)}></div>
        <div className="fixed inset-y-0 left-0 w-64 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
          <div className="p-4 flex items-center justify-between border-b border-sidebar-border">
            <h2 className="text-lg font-semibold tracking-tight">Admin Panel</h2>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:hidden"
              onClick={() => setSidebarOpen(false)}
            >
              ✕
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 my-0.5 text-sm font-medium transition-colors ${
                  pathname.startsWith(item.href)
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="text-base">{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      
      {/* Static sidebar for desktop */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex-1 flex flex-col min-h-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
          <div className="p-4 flex items-center border-b border-sidebar-border">
            <h2 className="text-lg font-semibold tracking-tight">Admin Panel</h2>
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 my-0.5 text-sm font-medium transition-colors ${
                  pathname.startsWith(item.href)
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.name}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      
      {/* Main content */}
      <div className="lg:pl-64 flex flex-col flex-1">
        <main className="flex-1 pt-16 lg:pt-0">
          <div className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
} 