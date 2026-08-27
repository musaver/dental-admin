import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user, courses, orders, adminUsers, attendance } from '@/lib/schema';
import { count, and, gte, lte } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build date filters
    const buildDateFilter = (dateField: any) => {
      const filters = [];
      if (startDate) {
        filters.push(gte(dateField, new Date(startDate)));
      }
      if (endDate) {
        // Add one day to endDate to include the entire end date
        const endDatePlusOne = new Date(endDate);
        endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
        filters.push(lte(dateField, endDatePlusOne));
      }
      return filters.length > 0 ? and(...filters) : undefined;
    };

    // Get counts for all entities with date filters
    const [
      usersCount,
      coursesCount,
      ordersCount,
      adminUsersCount,
      attendanceCount
    ] = await Promise.all([
      // Users - filter by createdAt if it exists, otherwise get all
      db.select({ count: count() }).from(user).where(buildDateFilter(user.createdAt)),
      
      // Courses - filter by createdAt
      db.select({ count: count() }).from(courses).where(buildDateFilter(courses.createdAt)),
      
      // Orders - filter by createdAt
      db.select({ count: count() }).from(orders).where(buildDateFilter(orders.createdAt)),
      
      // Admin Users - filter by createdAt
      db.select({ count: count() }).from(adminUsers).where(buildDateFilter(adminUsers.createdAt)),
      
      // Attendance - filter by date/createdAt
      db.select({ count: count() }).from(attendance).where(buildDateFilter(attendance.date))
    ]);

    const stats = {
      users: usersCount[0]?.count || 0,
      courses: coursesCount[0]?.count || 0,
      orders: ordersCount[0]?.count || 0,
      adminUsers: adminUsersCount[0]?.count || 0,
      attendance: attendanceCount[0]?.count || 0,
      dateRange: {
        startDate,
        endDate
      }
    };

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard statistics' }, { status: 500 });
  }
} 