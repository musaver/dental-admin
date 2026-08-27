import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user, orders } from '@/lib/schema';
import { and, or, eq, like, inArray } from 'drizzle-orm';

// Powers the announcement recipient picker.
// Query params: courseId?, batchId?, search?, page=1, pageSize=20
// Returns a paginated page of users plus allMatchingIds (ids only) so the UI can
// default-select everyone and track exclusions across pages.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get('courseId') || '';
    const batchId = searchParams.get('batchId') || '';
    const search = (searchParams.get('search') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));

    // If a course/batch filter is set, restrict to users enrolled via orders.
    let enrolledIds: string[] | null = null;
    if (courseId || batchId) {
      const orderConditions = [] as any[];
      if (courseId) orderConditions.push(eq(orders.courseId, courseId));
      if (batchId) orderConditions.push(eq(orders.batchId, batchId));

      const enrolledRows = await db
        .selectDistinct({ userId: orders.userId })
        .from(orders)
        .where(orderConditions.length > 1 ? and(...orderConditions) : orderConditions[0]);

      enrolledIds = [...new Set(enrolledRows.map((r) => r.userId).filter(Boolean))] as string[];

      // No one enrolled -> nothing to show
      if (enrolledIds.length === 0) {
        return NextResponse.json({ users: [], total: 0, page, pageSize, allMatchingIds: [] });
      }
    }

    const conditions = [] as any[];
    if (enrolledIds) conditions.push(inArray(user.id, enrolledIds));
    if (search) {
      const term = `%${search}%`;
      conditions.push(or(like(user.name, term), like(user.email, term)));
    }
    const whereClause =
      conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

    // Fetch all matching users (id/name/email only — cheap), then page in JS.
    const allMatching = await db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(whereClause)
      .orderBy(user.name);

    const total = allMatching.length;
    const allMatchingIds = allMatching.map((u) => u.id);
    const start = (page - 1) * pageSize;
    const users = allMatching.slice(start, start + pageSize);

    return NextResponse.json({ users, total, page, pageSize, allMatchingIds });
  } catch (error) {
    console.error('Error fetching recipients:', error);
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 });
  }
}
