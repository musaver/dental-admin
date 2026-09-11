# Dental Clinic Admin

A dentist-centric CRM and patient-management system: patients with a 360° view
(odontogram, visits, treatment plans, files, billing, communications),
an appointment book with chair/dentist conflict detection, recalls, invoicing
with a patient ledger, a leads funnel with one-click conversion, role-based
access for clinic staff, an audit trail, a full data export, and a patient
portal with OTP sign-in and treatment-plan acceptance.

**Stack:** Next.js 15 (App Router) · Drizzle ORM · MySQL · NextAuth ·
Vercel Blob · Brevo · Tailwind v4.

## Getting started

```bash
npm install
cp env.example .env        # fill in DB_*, NEXTAUTH_SECRET, BREVO_*
npm run db:baseline        # once, against a database that already has the tables
npm run dev
```

## Environment

| Variable | Purpose |
|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASS` `DB_NAME` | MySQL connection |
| `NEXTAUTH_SECRET` `NEXTAUTH_URL` | Sessions and signed portal invites |
| `BREVO_API_KEY` `BREVO_SENDER_EMAIL` | Transactional email (sender must be Brevo-verified) |
| `CRON_SECRET` | Authenticates `/api/cron/daily` |
| `EMAIL_DRY_RUN=1` | Log emails instead of sending (development) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob uploads |

## Commands

```bash
npm run dev / build / start
npm test                   # 209 unit tests (node:test — no framework dependency)
npm run check              # typecheck + tests + all live-database checks
npm run db:generate        # emit a migration from schema changes — READ IT before applying
npm run db:migrate         # apply pending migrations
npm run check:invariants   # detect denormalisation/pointer drift
npm run repair:orphans     # dry-run orphan cleanup (--apply to fix)
```

HTTP-level suites need the dev server running with `EMAIL_DRY_RUN=1`:
`check:reminders`, `check:export`, `check:portal`, `check:booking`.

## Before you change anything

Read **[CONVENTIONS.md](CONVENTIONS.md)**. The database has no foreign keys,
no CHECK constraints and no triggers — every invariant that matters is
enforced in application code, and that file says where each one lives.

Two of them save you from real trouble:

- `lib/schema.ts` is hand-maintained. **Do not regenerate it** from the
  database; you would silently lose 80 indexes.
- `db:push` is called `db:push:DANGER` because against a drifted snapshot it
  will emit `DROP TABLE` for live tables.

## Deployment

Built for Vercel. `vercel.json` schedules the daily job (reminders, recall
emails, telemetry purge) at 04:00 UTC — 09:00 clinic time. Set `CRON_SECRET`
so Vercel authenticates it, and use the Pro plan if exports and reminder
batches need more than 60 seconds.
