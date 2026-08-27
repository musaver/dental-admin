'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatPKR } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const statusVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'outline'> = {
  unpaid: 'secondary',
  partial: 'default',
  paid: 'success',
  waived: 'outline',
  refunded: 'destructive',
};

export default function FeeCalculationsDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const [statsRes, invoicesRes] = await Promise.all([
        fetch(`/api/fee-calculations/stats?${params.toString()}`),
        fetch('/api/fee-invoices'),
      ]);
      setStats(await statsRes.json());
      const invoices = await invoicesRes.json();
      setRecent(Array.isArray(invoices) ? invoices.slice(0, 10) : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = [
    { title: 'Billed', value: stats?.totalBilled },
    { title: 'Collected', value: stats?.totalCollected },
    { title: 'Outstanding', value: stats?.totalOutstanding },
    { title: 'Refunded', value: stats?.totalRefunded },
  ];

  const sections = [
    { name: 'Fee Structures', href: '/fee-calculations/structures', desc: 'Base fee + components per course', icon: '🧾' },
    { name: 'Discounts', href: '/fee-calculations/discounts', desc: 'Scholarships & discounts', icon: '🎓' },
    { name: 'Generate Invoices', href: '/fee-calculations/generate', desc: 'Create monthly invoices', icon: '⚙️' },
    { name: 'Invoices', href: '/fee-calculations/invoices', desc: 'View & collect payments', icon: '📂' },
  ];

  return (
    <div className="p-4">
      <h1 className="text-3xl font-bold tracking-tight mb-6">💰 Fee Calculations</h1>

      {/* Date filter */}
      <Card className="mb-6">
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={fetchStats} className="w-full">Apply Filter</Button>
            </div>
            <div className="flex items-end">
              <Button onClick={() => { setStartDate(''); setEndDate(''); setTimeout(fetchStats, 50); }} variant="secondary" className="w-full">Clear</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardTitle className="text-lg">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tracking-tight">{loading ? '...' : formatPKR(c.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status breakdown */}
      {stats?.statusCounts && Object.keys(stats.statusCounts).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8">
          {Object.entries(stats.statusCounts).map(([status, c]: any) => (
            <Badge key={status} variant={statusVariants[status] || 'secondary'}>
              {status}: {c}
            </Badge>
          ))}
        </div>
      )}

      {/* Section links */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="block">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent>
                <div className="text-3xl mb-2">{s.icon}</div>
                <div className="font-semibold">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Recent invoices */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight mb-3">Recent Invoices</h2>
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Student</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.length > 0 ? (
                recent.map((r) => {
                  const inv = r.invoice;
                  const balance = (inv.totalAmount || 0) - (inv.paidAmount || 0);
                  return (
                    <TableRow key={inv.id}>
                      <TableCell>{r.user?.name || r.user?.email || 'Unknown'}</TableCell>
                      <TableCell>{r.course?.title || '-'}</TableCell>
                      <TableCell>{inv.period}</TableCell>
                      <TableCell>{formatPKR(inv.totalAmount)}</TableCell>
                      <TableCell>{formatPKR(balance)}</TableCell>
                      <TableCell><Badge variant={statusVariants[inv.status] || 'secondary'}>{inv.status}</Badge></TableCell>
                      <TableCell><Button asChild size="sm"><Link href={`/fee-calculations/invoices/${inv.id}`}>View</Link></Button></TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">No invoices yet</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
