import { pool } from '@/lib/db';
import { withAuth } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/enums';
import { EXPORT_TABLES } from '@/lib/export-allowlist';
import { clinicNow, toDateKey } from '@/lib/datetime';
import { NextResponse } from 'next/server';

/**
 * The full clinic export: everything the clinic owns, as NDJSON.
 *
 * Line 1 is a manifest; every following line is {"table","row"}. NDJSON over
 * ZIP because it streams from the first byte in constant memory — no archive
 * to assemble, nothing buffered, restartable, and any script can parse it.
 *
 * Non-negotiables:
 *  - export_data permission.
 *  - The audit row is written BEFORE the stream opens. A client can abort a
 *    stream; it cannot un-ask for the export.
 *  - Column allowlists only. `select *` here is a credential dump.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAGE = 500;

export const GET = withAuth(PERMISSIONS.EXPORT_DATA, async (req, ctx) => {
  const startedAt = clinicNow();

  // Rate limit from the audit trail itself: no new table needed, and the
  // count survives restarts.
  const [counted] = (await pool.query(
    `SELECT COUNT(*) AS n FROM audit_logs
      WHERE actorId = ? AND action = 'export' AND createdAt > NOW() - INTERVAL 24 HOUR`,
    [ctx.userId]
  )) as unknown as [{ n: number }[]];

  if (Number(counted[0]?.n ?? 0) >= 3) {
    return NextResponse.json(
      { error: 'Limit reached: three full exports per person per day.', code: 'RATE_LIMITED' },
      { status: 429 }
    );
  }

  // BEFORE the stream. An aborted download is still an export that happened.
  await writeAuditLog({
    actor: ctx,
    action: AUDIT_ACTION.EXPORT,
    entityType: AUDIT_ENTITY.CLINIC,
    entityId: 'full-export',
    after: { tables: EXPORT_TABLES.length, startedAt },
    request: req,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));

      try {
        write({
          _meta: {
            exportedAt: startedAt,
            exportedBy: ctx.email,
            tables: EXPORT_TABLES.map((t) => t.table),
            format: 'ndjson/1',
          },
        });

        for (const { table, columns } of EXPORT_TABLES) {
          const columnSql = columns.map((c) => `\`${c}\``).join(', ');

          // Keyset pagination on the primary key: constant memory however
          // large a table grows.
          let cursor = '';
          for (;;) {
            const [rows] = (await pool.query(
              `SELECT ${columnSql} FROM \`${table}\`
                WHERE id > ? ORDER BY id LIMIT ${PAGE}`,
              [cursor]
            )) as unknown as [Record<string, unknown>[]];

            for (const row of rows) write({ table, row });
            if (rows.length < PAGE) break;
            cursor = String(rows[rows.length - 1]!.id);
          }
        }

        write({ _done: { finishedAt: new Date().toISOString() } });
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const filename = `clinic-export-${toDateKey(startedAt)}.ndjson`;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
