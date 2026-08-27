import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { attendance, classes, orders, user } from '@/lib/schema';
import { v4 as uuidv4 } from 'uuid';
import { eq, and, isNotNull } from 'drizzle-orm';
import {
  getPastMeetingInstances,
  getMeetingParticipants,
  parseZoomMeetingId,
  ZoomParticipant,
} from '@/lib/zoom';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
// How close a Zoom instance's start must be to the class time to be considered "this class".
const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeName(name?: string | null): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

interface SyncSummary {
  classId: string;
  classTitle: string;
  meetingId: string | null;
  instanceUuid: string | null;
  matched: number;
  attendanceWritten: number;
  unmatchedParticipants: string[];
  skipped?: string;
}

function aggregateParticipants(participants: ZoomParticipant[]) {
  const map = new Map<string, { email: string; name: string; join: number; leave: number; seconds: number }>();
  for (const p of participants) {
    const email = (p.user_email || '').trim().toLowerCase();
    const key = email || `name:${normalizeName(p.name)}`;
    if (!key || key === 'name:') continue;
    const join = p.join_time ? new Date(p.join_time).getTime() : 0;
    const leave = p.leave_time ? new Date(p.leave_time).getTime() : 0;
    const existing = map.get(key);
    if (existing) {
      existing.join = Math.min(existing.join || join, join || existing.join);
      existing.leave = Math.max(existing.leave, leave);
      existing.seconds += p.duration || 0;
    } else {
      map.set(key, { email, name: p.name || '', join, leave, seconds: p.duration || 0 });
    }
  }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    // Auth: the admin middleware already gates every /api/* route by session,
    // so reaching this handler implies an authenticated admin. (A future headless
    // cron would need the middleware to allow an x-sync-secret header.)
    const body = await request.json().catch(() => ({}));
    const classId: string | undefined = body?.classId;
    const sinceDays: number = Number(body?.sinceDays) > 0 ? Number(body.sinceDays) : 30;

    // Target one class, or all classes that have a Zoom link, scheduled within sinceDays.
    let targetClasses;
    if (classId) {
      targetClasses = await db.select().from(classes).where(eq(classes.id, classId));
    } else {
      const cutoff = new Date(Date.now() - sinceDays * DAY_MS);
      targetClasses = (await db.select().from(classes).where(isNotNull(classes.zoomLink))).filter(
        (c) => !c.scheduledAt || new Date(c.scheduledAt).getTime() >= cutoff.getTime()
      );
    }

    const summaries: SyncSummary[] = [];

    for (const cls of targetClasses) {
      const meetingId = (cls.zoomMeetingId && cls.zoomMeetingId.trim()) || parseZoomMeetingId(cls.zoomLink || '');
      const summary: SyncSummary = {
        classId: cls.id,
        classTitle: cls.title,
        meetingId,
        instanceUuid: null,
        matched: 0,
        attendanceWritten: 0,
        unmatchedParticipants: [],
      };

      if (!meetingId) {
        summary.skipped = 'No Zoom meeting ID (set a zoom link / meeting ID on the class).';
        summaries.push(summary);
        continue;
      }

      // Enrolled students for this class's batch (completed orders).
      const enrolledRows = await db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,
        })
        .from(orders)
        .innerJoin(user, eq(orders.userId, user.id))
        .where(and(eq(orders.batchId, cls.batchId), eq(orders.status, 'completed')));

      const byEmail = new Map<string, (typeof enrolledRows)[number]>();
      const byName = new Map<string, (typeof enrolledRows)[number]>();
      for (const u of enrolledRows) {
        if (u.email) byEmail.set(u.email.trim().toLowerCase(), u);
        for (const c of [u.name, u.displayName, [u.firstName, u.lastName].filter(Boolean).join(' ')]) {
          const n = normalizeName(c);
          if (n && !byName.has(n)) byName.set(n, u);
        }
      }

      // Resolve the meeting instance closest to this class's scheduled time.
      const scheduledMs = cls.scheduledAt ? new Date(cls.scheduledAt).getTime() : Date.now();
      const instances = await getPastMeetingInstances(meetingId);
      let chosen: { uuid: string; start_time: string } | null = null;
      if (instances.length > 0) {
        let best = Infinity;
        for (const inst of instances) {
          const diff = Math.abs(new Date(inst.start_time).getTime() - scheduledMs);
          if (diff < best) { best = diff; chosen = inst; }
        }
        // If the closest instance is far from the class time, it likely hasn't happened yet.
        if (chosen && best > MATCH_WINDOW_MS) {
          summary.skipped = `No Zoom instance within 24h of the class time (closest is ${Math.round(best / DAY_MS)}d off).`;
          summaries.push(summary);
          continue;
        }
      }
      // One-off fallback: no listed instances -> use the meeting id directly.
      if (!chosen) chosen = { uuid: meetingId, start_time: cls.scheduledAt ? new Date(cls.scheduledAt).toISOString() : new Date().toISOString() };

      summary.instanceUuid = chosen.uuid;

      let participants: ZoomParticipant[];
      try {
        participants = await getMeetingParticipants(chosen.uuid);
      } catch (e: any) {
        summary.skipped = `Zoom report not available yet for this meeting (${e?.message || 'try again after the class ends'}).`;
        summaries.push(summary);
        continue;
      }

      const instanceDate = new Date(chosen.start_time);
      const aggregated = aggregateParticipants(participants);

      for (const [, agg] of aggregated) {
        let matchedUser = agg.email ? byEmail.get(agg.email) : undefined;
        if (!matchedUser) matchedUser = byName.get(normalizeName(agg.name));

        if (!matchedUser) {
          const label = agg.name || agg.email || 'Unknown';
          if (!summary.unmatchedParticipants.includes(label)) summary.unmatchedParticipants.push(label);
          continue;
        }

        summary.matched++;
        const joinTime = agg.join ? new Date(agg.join) : null;
        const leaveTime = agg.leave ? new Date(agg.leave) : null;
        const durationMinutes = Math.round(agg.seconds / 60);

        // Upsert keyed by (userId, classId, meetingUuid).
        const existing = await db
          .select({ id: attendance.id })
          .from(attendance)
          .where(
            and(
              eq(attendance.userId, matchedUser.id),
              eq(attendance.classId, cls.id),
              eq(attendance.meetingUuid, chosen.uuid)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(attendance)
            .set({ date: instanceDate, time: joinTime || instanceDate, source: 'zoom', joinTime, leaveTime, durationMinutes })
            .where(eq(attendance.id, existing[0].id));
        } else {
          await db.insert(attendance).values({
            id: uuidv4(),
            userId: matchedUser.id,
            batchId: cls.batchId,
            classId: cls.id,
            date: instanceDate,
            time: joinTime || instanceDate,
            source: 'zoom',
            joinTime,
            leaveTime,
            durationMinutes,
            meetingUuid: chosen.uuid,
          });
        }
        summary.attendanceWritten++;
      }

      // Remember which instance this class mapped to.
      await db.update(classes).set({ meetingUuid: chosen.uuid }).where(eq(classes.id, cls.id));

      summaries.push(summary);
    }

    const totals = summaries.reduce(
      (acc, s) => { acc.matched += s.matched; acc.attendanceWritten += s.attendanceWritten; return acc; },
      { matched: 0, attendanceWritten: 0 }
    );

    return NextResponse.json({ success: true, classesProcessed: summaries.length, ...totals, results: summaries });
  } catch (error: any) {
    console.error('Error syncing class attendance from Zoom:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
