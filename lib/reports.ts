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
 *  - UNBILLED = a completed visit with at least one non-cancelled
 *    visit_procedure that no invoice_items row references. NOT "a visit with
 *    no invoice": bill one of three procedures and that test drops the visit
 *    off the worklist for ever with two still unbilled, which is exactly the
 *    revenue leak the worklist exists to catch. This matches
 *    buildLinesFromVisit() clause for clause, so a row in the worklist always
 *    produces a non-empty invoice.
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

/**
 * Units for a performed procedure, in SQL.
 *
 * visit_procedures.price is PER UNIT and the table has no quantity column, so
 * for a per-tooth procedure the tooth count carries it. This is the SQL mirror
 * of toothCount() in lib/odontogram.ts — kept in one place because three
 * hand-copied versions drift three separate ways.
 *
 * Expects the aliases `vp` (visit_procedures) and `p` (procedures).
 */
const PROCEDURE_UNITS_SQL = `GREATEST(1,
              CASE WHEN p.isPerTooth = 1 AND vp.teeth IS NOT NULL AND vp.teeth <> ''
                   THEN LENGTH(vp.teeth) - LENGTH(REPLACE(vp.teeth, ',', '')) + 1
                   ELSE 1 END)`;

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
            CAST(SUM(vp.price * ${PROCEDURE_UNITS_SQL}) AS SIGNED) AS revenue
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
            CAST(SUM(vp.price * ${PROCEDURE_UNITS_SQL}) AS SIGNED) AS revenue
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

/* ── Unbilled work ───────────────────────────────────────────────────── */

export interface UnbilledVisitsQuery {
  /** null = every branch (head office). */
  branchIds: string[] | null;
  limit: number;
  offset: number;
}

export interface UnbilledVisit {
  id: string;
  visitDate: string;
  patientId: string;
  mrn: string | null;
  firstName: string | null;
  lastName: string | null;
  dentistName: string | null;
  procedures: number;
  estimatedAmount: number;
}

/**
 * The predicate, shared by the list and its count.
 *
 * The NOT EXISTS sits on the JOINED visit_procedures row rather than on the
 * visit, so one clause does both jobs: it selects the visits AND scopes the
 * SUM to only the work the resulting invoice will actually contain.
 *
 * The second NOT EXISTS mirrors the plan-item guard in buildLinesFromVisit():
 * work already billed through its treatment plan is not billable again here,
 * and a worklist that disagreed with the builder would offer invoices the
 * server refuses.
 *
 * No "has any procedures" guard is needed — a visit with no procedures has no
 * unbilled procedure, so it falls out for free.
 *
 * Branch scoping is on visits.branchId. visit_procedures and invoice_items are
 * two of the branchless tables and are reached only through the filtered `v`,
 * which is the SQL equivalent of the loader rule in lib/loaders.ts.
 */
const UNBILLED_VISITS_JOINS = `
       FROM visits v
       JOIN visit_procedures vp ON vp.visitId = v.id AND vp.status <> 'cancelled'
       LEFT JOIN procedures p ON p.id = vp.procedureId`;

const UNBILLED_VISITS_WHERE = `
      WHERE v.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM invoice_items ii WHERE ii.visitProcedureId = vp.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM invoice_items ii
           WHERE vp.treatmentPlanItemId IS NOT NULL
             AND ii.treatmentPlanItemId = vp.treatmentPlanItemId
        )`;

/** Display-only joins: the list needs these, the count does not. */
const UNBILLED_VISITS_DISPLAY_JOINS = `
       LEFT JOIN patients pa ON pa.id = v.patientId
       LEFT JOIN admin_users au ON au.id = v.dentistId`;

/**
 * Completed visits with work nobody has billed.
 *
 * estimatedAmount is GROSS — before the patient's standing discount, which
 * createInvoice() appends afterwards as its own line. Label the column "Est."
 * wherever it is shown: a worklist figure that silently disagrees with the
 * invoice it produces is worse than no figure at all.
 *
 * Oldest first, deliberately unlike the other visit lists: a backlog is worked
 * from the old end, and the oldest stragglers are the ones at risk of never
 * being billed at all.
 */
export async function unbilledVisits(query: UnbilledVisitsQuery): Promise<UnbilledVisit[]> {
  const branch = branchClause('v.branchId', query.branchIds);
  return rows<UnbilledVisit>(
    `SELECT v.id, v.visitDate, v.patientId,
            pa.mrn, pa.firstName, pa.lastName,
            au.name AS dentistName,
            CAST(COUNT(vp.id) AS SIGNED) AS procedures,
            CAST(SUM(vp.price * ${PROCEDURE_UNITS_SQL}) AS SIGNED) AS estimatedAmount
       ${UNBILLED_VISITS_JOINS}${UNBILLED_VISITS_DISPLAY_JOINS}${UNBILLED_VISITS_WHERE}${branch.sql}
      GROUP BY v.id, v.visitDate, v.patientId, pa.mrn, pa.firstName, pa.lastName, au.name
      ORDER BY v.visitDate ASC
      LIMIT ? OFFSET ?`,
    [...branch.params, query.limit, query.offset]
  );
}

/** How many visits the worklist holds, for pagination and the header count. */
export async function countUnbilledVisits(branchIds: string[] | null): Promise<number> {
  const branch = branchClause('v.branchId', branchIds);
  const [row] = await rows<{ n: number }>(
    `SELECT CAST(COUNT(DISTINCT v.id) AS SIGNED) AS n
       ${UNBILLED_VISITS_JOINS}${UNBILLED_VISITS_WHERE}${branch.sql}`,
    branch.params
  );
  return Number(row?.n ?? 0);
}
