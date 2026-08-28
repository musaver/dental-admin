import { pool } from '@/lib/db';

/**
 * Report queries.
 *
 * Library-first: every report is a pure async function over SQL aggregation,
 * so the route is a ten-line wrapper, a CSV export reuses the identical query,
 * and moving a page to a server component later changes one call site.
 *
 * ALL aggregation happens in SQL. Fetching rows to sum them in JavaScript
 * works in the demo and collapses on the first real month of data.
 *
 * Definitions are pinned here because ambiguous metrics kill trust in a
 * dashboard:
 *
 *  - REVENUE (production) = Σ visit_procedures.price × units, by visit date.
 *    Work done, attributed to WHO DID IT (performedBy) — never to whoever
 *    happened to raise the invoice.
 *  - COLLECTIONS = Σ signed payments by payment date. Money in the door.
 *  - OUTSTANDING = Σ (totalAmount − paidAmount) over open invoices.
 *  - NO-SHOW RATE = no_show / (completed + no_show + cancelled): of the
 *    appointments that reached their day, how many died. Dividing by all
 *    bookings would flatter the number with the still-scheduled future.
 */

export interface ReportRange {
  from: Date;
  to: Date;
  /** null = every branch (head office). */
  branchIds: string[] | null;
}

function branchClause(column: string, branchIds: string[] | null): { sql: string; params: string[] } {
  if (!branchIds || branchIds.length === 0) return { sql: '', params: [] };
  return {
    sql: ` AND ${column} IN (${branchIds.map(() => '?').join(',')})`,
    params: branchIds,
  };
}

async function rows<T>(sql: string, params: unknown[]): Promise<T[]> {
  const [result] = await pool.query(sql, params);
  return result as T[];
}

/* ── Financial ───────────────────────────────────────────────────────── */

export interface CollectionsByDay {
  day: string;
  collected: number;
  refunded: number;
  net: number;
}

export async function collectionsByDay(range: ReportRange): Promise<CollectionsByDay[]> {
  const branch = branchClause('branchId', range.branchIds);
  return rows<CollectionsByDay>(
    `SELECT DATE_FORMAT(paymentDate, '%Y-%m-%d') AS day,
            CAST(SUM(CASE WHEN type <> 'refund' THEN amount ELSE 0 END) AS SIGNED) AS collected,
            CAST(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) AS SIGNED) AS refunded,
            CAST(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS SIGNED) AS net
       FROM payments
      WHERE paymentDate >= ? AND paymentDate < ?${branch.sql}
      GROUP BY day ORDER BY day`,
    [range.from, range.to, ...branch.params]
  );
}

export interface CollectionsByMethod {
  method: string | null;
  count: number;
  net: number;
}

export async function collectionsByMethod(range: ReportRange): Promise<CollectionsByMethod[]> {
  const branch = branchClause('branchId', range.branchIds);
  return rows<CollectionsByMethod>(
    `SELECT method,
            COUNT(*) AS count,
            CAST(SUM(CASE WHEN type = 'refund' THEN -amount ELSE amount END) AS SIGNED) AS net
       FROM payments
      WHERE paymentDate >= ? AND paymentDate < ?${branch.sql}
      GROUP BY method ORDER BY net DESC`,
    [range.from, range.to, ...branch.params]
  );
}

export interface OutstandingSummary {
  invoices: number;
  billed: number;
  paid: number;
  outstanding: number;
}

export async function outstandingSummary(branchIds: string[] | null): Promise<OutstandingSummary> {
  const branch = branchClause('branchId', branchIds);
  const [row] = await rows<OutstandingSummary>(
    `SELECT COUNT(*) AS invoices,
            CAST(COALESCE(SUM(totalAmount), 0) AS SIGNED) AS billed,
            CAST(COALESCE(SUM(paidAmount), 0) AS SIGNED) AS paid,
            CAST(COALESCE(SUM(totalAmount - paidAmount), 0) AS SIGNED) AS outstanding
       FROM invoices
      WHERE status IN ('unpaid', 'partial')${branch.sql}`,
    branch.params
  );
  return row ?? { invoices: 0, billed: 0, paid: 0, outstanding: 0 };
}

export interface RevenueByDentist {
  dentistId: string;
  dentistName: string | null;
  procedures: number;
  revenue: number;
}

/** Production per clinician. performedBy, never invoices.createdBy. */
export async function revenueByDentist(range: ReportRange): Promise<RevenueByDentist[]> {
  const branch = branchClause('v.branchId', range.branchIds);
  return rows<RevenueByDentist>(
    `SELECT vp.performedBy AS dentistId,
            au.name AS dentistName,
            COUNT(*) AS procedures,
            CAST(SUM(vp.price * GREATEST(1,
              CASE WHEN p.isPerTooth = 1 AND vp.teeth IS NOT NULL AND vp.teeth <> ''
                   THEN LENGTH(vp.teeth) - LENGTH(REPLACE(vp.teeth, ',', '')) + 1
                   ELSE 1 END)) AS SIGNED) AS revenue
       FROM visit_procedures vp
       JOIN visits v ON v.id = vp.visitId
       LEFT JOIN procedures p ON p.id = vp.procedureId
       LEFT JOIN admin_users au ON au.id = vp.performedBy
      WHERE v.visitDate >= ? AND v.visitDate < ?
        AND vp.status = 'completed'${branch.sql}
      GROUP BY vp.performedBy, au.name
      ORDER BY revenue DESC`,
    [range.from, range.to, ...branch.params]
  );
}

export interface RevenueByCategory {
  category: string | null;
  procedures: number;
  revenue: number;
}

export async function revenueByCategory(range: ReportRange): Promise<RevenueByCategory[]> {
  const branch = branchClause('v.branchId', range.branchIds);
  return rows<RevenueByCategory>(
    `SELECT p.category,
            COUNT(*) AS procedures,
            CAST(SUM(vp.price * GREATEST(1,
              CASE WHEN p.isPerTooth = 1 AND vp.teeth IS NOT NULL AND vp.teeth <> ''
                   THEN LENGTH(vp.teeth) - LENGTH(REPLACE(vp.teeth, ',', '')) + 1
                   ELSE 1 END)) AS SIGNED) AS revenue
       FROM visit_procedures vp
       JOIN visits v ON v.id = vp.visitId
       LEFT JOIN procedures p ON p.id = vp.procedureId
      WHERE v.visitDate >= ? AND v.visitDate < ?
        AND vp.status = 'completed'${branch.sql}
      GROUP BY p.category
      ORDER BY revenue DESC`,
    [range.from, range.to, ...branch.params]
  );
}

/* ── Clinical ────────────────────────────────────────────────────────── */

export interface AppointmentStats {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** no_show / (completed + no_show + cancelled). See the header note. */
  noShowRate: number;
}

export async function appointmentStats(range: ReportRange): Promise<AppointmentStats> {
  const branch = branchClause('branchId', range.branchIds);
  const [row] = await rows<{ total: number; completed: number; cancelled: number; noShow: number }>(
    `SELECT COUNT(*) AS total,
            CAST(SUM(status = 'completed') AS SIGNED) AS completed,
            CAST(SUM(status = 'cancelled') AS SIGNED) AS cancelled,
            CAST(SUM(status = 'no_show') AS SIGNED) AS noShow
       FROM appointments
      WHERE startAt >= ? AND startAt < ?${branch.sql}`,
    [range.from, range.to, ...branch.params]
  );

  const completed = Number(row?.completed ?? 0);
  const cancelled = Number(row?.cancelled ?? 0);
  const noShow = Number(row?.noShow ?? 0);
  const settled = completed + cancelled + noShow;

  return {
    total: Number(row?.total ?? 0),
    completed,
    cancelled,
    noShow,
    noShowRate: settled ? Math.round((noShow / settled) * 1000) / 10 : 0,
  };
}

export interface AcceptanceStats {
  proposed: number;
  accepted: number;
  proposedValue: number;
  acceptedValue: number;
  /** By count and by value: the value figure is the one an owner acts on. */
  rateByCount: number;
  rateByValue: number;
}

export async function treatmentAcceptance(range: ReportRange): Promise<AcceptanceStats> {
  const branch = branchClause('branchId', range.branchIds);
  const [row] = await rows<{
    proposed: number;
    accepted: number;
    proposedValue: number;
    acceptedValue: number;
  }>(
    `SELECT COUNT(*) AS proposed,
            CAST(SUM(acceptedAt IS NOT NULL) AS SIGNED) AS accepted,
            CAST(COALESCE(SUM(netAmount), 0) AS SIGNED) AS proposedValue,
            CAST(COALESCE(SUM(CASE WHEN acceptedAt IS NOT NULL THEN netAmount ELSE 0 END), 0) AS SIGNED) AS acceptedValue
       FROM treatment_plans
      WHERE proposedAt >= ? AND proposedAt < ?${branch.sql}`,
    [range.from, range.to, ...branch.params]
  );

  const proposed = Number(row?.proposed ?? 0);
  const accepted = Number(row?.accepted ?? 0);
  const proposedValue = Number(row?.proposedValue ?? 0);
  const acceptedValue = Number(row?.acceptedValue ?? 0);

  return {
    proposed,
    accepted,
    proposedValue,
    acceptedValue,
    rateByCount: proposed ? Math.round((accepted / proposed) * 1000) / 10 : 0,
    rateByValue: proposedValue ? Math.round((acceptedValue / proposedValue) * 1000) / 10 : 0,
  };
}

export interface NewPatients {
  registered: number;
}

export async function newPatients(range: ReportRange): Promise<NewPatients> {
  const branch = branchClause('branchId', range.branchIds);
  const [row] = await rows<{ registered: number }>(
    `SELECT COUNT(*) AS registered
       FROM patients
      WHERE createdAt >= ? AND createdAt < ?${branch.sql}`,
    [range.from, range.to, ...branch.params]
  );
  return { registered: Number(row?.registered ?? 0) };
}

/* ── CRM ─────────────────────────────────────────────────────────────── */

export interface LeadFunnelRow {
  source: string;
  total: number;
  converted: number;
  lost: number;
  conversionRate: number;
}

/** Where enquiries come from, and which sources actually become patients. */
export async function leadSourcePerformance(range: ReportRange): Promise<LeadFunnelRow[]> {
  const branch = branchClause('branchId', range.branchIds);
  const raw = await rows<{ source: string; total: number; converted: number; lost: number }>(
    `SELECT source,
            COUNT(*) AS total,
            CAST(SUM(status = 'converted') AS SIGNED) AS converted,
            CAST(SUM(status = 'lost') AS SIGNED) AS lost
       FROM leads
      WHERE createdAt >= ? AND createdAt < ?${branch.sql}
      GROUP BY source ORDER BY total DESC`,
    [range.from, range.to, ...branch.params]
  );

  return raw.map((row) => ({
    ...row,
    total: Number(row.total),
    converted: Number(row.converted),
    lost: Number(row.lost),
    conversionRate: Number(row.total)
      ? Math.round((Number(row.converted) / Number(row.total)) * 1000) / 10
      : 0,
  }));
}

/* ── Recalls ─────────────────────────────────────────────────────────── */

export interface RecallCompliance {
  due: number;
  booked: number;
  completed: number;
  overdue: number;
}

export async function recallCompliance(branchIds: string[] | null): Promise<RecallCompliance> {
  const branch = branchClause('branchId', branchIds);
  const [row] = await rows<RecallCompliance>(
    `SELECT CAST(SUM(status = 'pending' AND dueDate >= NOW()) AS SIGNED) AS due,
            CAST(SUM(status = 'booked') AS SIGNED) AS booked,
            CAST(SUM(status = 'completed') AS SIGNED) AS completed,
            CAST(SUM(status = 'pending' AND dueDate < NOW()) AS SIGNED) AS overdue
       FROM recalls
      WHERE 1 = 1${branch.sql}`,
    branch.params
  );
  return {
    due: Number(row?.due ?? 0),
    booked: Number(row?.booked ?? 0),
    completed: Number(row?.completed ?? 0),
    overdue: Number(row?.overdue ?? 0),
  };
}
