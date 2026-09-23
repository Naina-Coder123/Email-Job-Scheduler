# ReachInbox Email Job Scheduler

A production-shaped slice of ReachInbox's email pipeline: schedule cold emails to
be sent at a specific time, at scale, with rate limiting, concurrency control,
Slack alerts, and a dashboard to track everything — built with Express,
BullMQ, Postgres, Redis, Elasticsearch and Next.js.

This was verified with a real end-to-end run (local Redis + Postgres + a fake
SMTP server standing in for Ethereal, whose account-creation API was not
reachable from the build sandbox — see **Known trade-offs**): emails were
scheduled, sent with the configured min-delay spacing, an hourly cap was hit
and the overflow emails were deferred to the next hour window instead of
being dropped, the worker was killed mid-flight and restarted, and — after
even flushing Redis entirely to simulate a worst-case data loss — every
still-pending email was picked back up from Postgres and delivered exactly
once with no duplicates.

## Table of contents

- [Architecture overview](#architecture-overview)
- [Feature checklist](#feature-checklist)
- [Getting started](#getting-started)
  - [1. Infra (Redis / Postgres / Elasticsearch)](#1-infra-redis--postgres--elasticsearch)
  - [2. Backend](#2-backend)
  - [3. Frontend](#3-frontend)
  - [4. Google OAuth setup](#4-google-oauth-setup)
  - [5. Slack app setup](#5-slack-app-setup)
- [How scheduling works](#how-scheduling-works)
- [How restart persistence works](#how-restart-persistence-works)
- [How rate limiting & concurrency work](#how-rate-limiting--concurrency-work)
- [Behavior under load (1000+ emails)](#behavior-under-load-1000-emails)
- [API reference](#api-reference)
- [Known trade-offs / shortcuts](#known-trade-offs--shortcuts)

## Architecture overview

```
┌─────────────┐        ┌──────────────────┐        ┌─────────────────┐
│  Next.js UI │◄──────►│  Express API      │◄──────►│  Postgres        │
│ (dashboard) │  REST  │  (backend/src)    │        │  (source of      │
└─────────────┘        └────────┬─────────┘        │   truth)         │
                                 │ enqueue                └─────────────────┘
                                 ▼
                        ┌──────────────────┐
                        │  BullMQ Queue     │◄──── backed by Redis
                        │  (delayed jobs)   │       (persists across
                        └────────┬─────────┘        restarts via AOF)
                                 │ pulls jobs
                                 ▼
                        ┌──────────────────┐        ┌─────────────────┐
                        │  BullMQ Worker(s) │───────►│  Ethereal SMTP   │
                        │  (backend/worker) │        │  (fake mail)    │
                        └────────┬─────────┘        └─────────────────┘
                                 │ index on send
                                 ▼
                        ┌──────────────────┐        ┌─────────────────┐
                        │  Elasticsearch    │        │  Slack webhook   │
                        │  (search)         │        │  (rate-limit     │
                        └──────────────────┘        │   alerts)        │
                                                     └─────────────────┘
```

- **`backend/`** — Express API (`src/index.ts`) + a separate BullMQ worker
  process (`src/worker.ts`). They share the same Postgres/Redis and can be
  scaled independently (e.g. run 3 worker replicas for more throughput while
  keeping 1 API instance).
- **`frontend/`** — Next.js 14 (App Router) + Tailwind dashboard. Google
  sign-in via NextAuth, everything else talks to the backend REST API.
- **Postgres** is the single source of truth for "what should be sent and
  when." Redis/BullMQ is the *execution* mechanism, not the source of truth
  — this is what makes restarts and even Redis data loss survivable (see
  below).

## Feature checklist

**Backend**
- [x] REST API to schedule/list/search emails (`src/routes/emails.ts`)
- [x] BullMQ delayed jobs for scheduling — **no cron anywhere**
- [x] Multi-sender support via Ethereal fake SMTP (`src/services/mailer.ts`, `src/routes/senders.ts`)
- [x] Elasticsearch indexing + search endpoint, with graceful degrade to a
      Postgres `ILIKE` fallback if ES is unreachable (`src/services/elasticsearch.ts`)
- [x] Live BullMQ dashboard (Bull Board) at `/admin/queues`, HTTP-basic-auth protected
- [x] Configurable worker concurrency (`WORKER_CONCURRENCY`)
- [x] Configurable minimum delay between sends via BullMQ's rate limiter (`MIN_DELAY_BETWEEN_EMAILS_MS`)
- [x] Configurable, Redis-backed, per-sender hourly cap (`MAX_EMAILS_PER_HOUR_PER_SENDER` / per-sender `hourlyLimit`)
- [x] Over-the-cap jobs are **deferred to the next hour window**, never dropped or failed
- [x] Real Slack OAuth (`src/routes/slack.ts`) + live webhook post the moment a cap is hit
- [x] Restart persistence: Postgres-backed reconciliation re-queues any
      scheduled email missing from BullMQ on boot (`src/queue/reconcile.ts`)
- [x] Idempotency: BullMQ `jobId === email.id` (no duplicate jobs) +
      DB status guard (`status === 'SENT'` short-circuits reprocessing)
- [x] Real Google ID-token verification server-side (`src/services/googleAuth.ts`)

**Frontend**
- [x] Real Google OAuth login via NextAuth, redirect to dashboard
- [x] Header with avatar / name / email + logout
- [x] Tabs: Scheduled emails / Sent emails
- [x] Compose modal: subject, body, CSV/text upload with detected-count
      feedback, manual paste fallback, start time, delay, hourly limit,
      multi-sender selection, inline "create sender" action
- [x] Scheduled/Sent tables with loading, empty, and error states
- [x] Search box wired to the backend's Elasticsearch-backed search endpoint
- [x] "Connect Slack" button (real OAuth redirect) with connected/disconnected state
- [x] Reusable UI kit: `Button`, `Input`/`Textarea`, `Modal`, `Badge`, `EmptyState`/`LoadingState`/`ErrorState`, `Toast`
- [x] Fully typed API client + shared TypeScript types for every response shape

## Getting started

### 1. Infra (Redis / Postgres / Elasticsearch)

Easiest path — Docker:

```bash
docker compose up -d redis postgres elasticsearch
```

Or run them natively (this is exactly how it was smoke-tested):

```bash
redis-server --daemonize yes
pg_ctlcluster <version> main start   # or `pg_ctl start` / `brew services start postgresql`
createdb email_scheduler
```

Elasticsearch is optional to get the app running — the API/worker log a
warning and keep working (search just falls back to Postgres `ILIKE`) if it
isn't reachable.

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in GOOGLE_CLIENT_ID, SLACK_*, etc. (see below)
npm install
npm run prisma:migrate      # creates tables
npm run seed                # creates a demo user + 2 Ethereal senders
npm run dev                 # API on :4000
```

In a **second terminal**, run the worker (this is intentionally a separate
process so it can be scaled independently of the API):

```bash
cd backend
npm run worker
```

Bull Board (live queue dashboard) is at `http://localhost:4000/admin/queues`
(basic auth, default `admin` / `admin`, configurable via `BULL_BOARD_USER` /
`BULL_BOARD_PASSWORD`).

### 3. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # fill in GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_SECRET
npm install
npm run dev                        # http://localhost:3000
```

### 4. Google OAuth setup

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth 2.0 Client ID (type: Web application).
2. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`.
3. Put the Client ID/Secret in `frontend/.env.local`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Put the **same** Client ID in `backend/.env` as `GOOGLE_CLIENT_ID` — the
   backend independently verifies the ID token Google issues against that
   audience before trusting it (`google-auth-library`, see
   `backend/src/services/googleAuth.ts`). Nothing about login is mocked: a
   forged or expired token is rejected with a 401.

### 5. Slack app setup

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) →
   "From scratch".
2. Under **OAuth & Permissions**, add redirect URL
   `http://localhost:4000/api/slack/callback` and the `incoming-webhook`
   scope.
3. Put the Client ID/Secret in `backend/.env`
   (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`).
4. Click "Connect Slack" in the dashboard → real Slack consent screen →
   the backend stores the resulting incoming-webhook URL per user
   (`SlackIntegration` table). Disconnecting removes it; reconnecting later
   starts notifications again immediately, no redeploy needed, because the
   worker looks the integration up fresh from Postgres on every rate-limit
   hit (`src/services/slack.ts`) — if there's no row, it silently no-ops.

## How scheduling works

`POST /api/emails/schedule` takes a subject/body, a recipient list (typed,
pasted, or extracted from an uploaded CSV/text file via
`src/services/csv.ts`), a start time, a delay, an hourly limit and a pool of
sender ids. For each recipient it:

1. Round-robins the sender pool across recipients.
2. Computes `scheduledAt = startTime + index * delayMs` so the schedule
   already reflects the requested pacing.
3. Bulk-inserts one `Email` row per recipient (Postgres = source of truth).
4. Bulk-adds one BullMQ **delayed job** per row via `Queue.addBulk`, with
   `delay = scheduledAt - now` and, critically, **`jobId = email.id`**.

No cron, anywhere. BullMQ's delayed-job set (a Redis sorted set keyed by
timestamp) *is* the scheduler — a background process inside BullMQ moves due
jobs from "delayed" to "waiting" and workers pull from there.

`jobId = email.id` is the idempotency key: calling `Queue.add`/`addBulk`
again with an id that's already waiting/delayed/active is a safe no-op, so
retrying a schedule call or re-running reconciliation can never create a
duplicate job for the same email.

## How restart persistence works

Two layers, deliberately redundant:

1. **Redis persistence.** The `docker-compose.yml` Redis runs with
   `--appendonly yes`, so in the common case (process crash, container
   restart) BullMQ's delayed jobs are still sitting in Redis exactly where
   they were and just keep firing on schedule.
2. **Postgres reconciliation** (`src/queue/reconcile.ts`), run on boot by
   both the API and the worker. It reads every `Email` row still in
   `SCHEDULED` status and checks whether BullMQ actually has a job for it
   (`queue.getJob(id)`); if not, it re-enqueues it with the correct
   remaining delay. This is what makes the system survive worse failures
   than a clean restart — it was verified by literally running
   `redis-cli flushall` (simulating total Redis data loss) with two emails
   still pending, then restarting the worker: the log read
   `2 scheduled email(s) found in DB, 2 re-queued`, and both were delivered
   correctly afterward. Postgres, not Redis, is the durable source of truth
   for *what* needs to be sent.

Combined with the `jobId = email.id` idempotency key, this reconciliation
pass is always safe to run — it will never create a duplicate job for an
email that's already queued, and the worker's own `status === 'SENT'` guard
means even a job that somehow got reprocessed can't send twice.

## How rate limiting & concurrency work

- **Concurrency** — `Worker` is created with `concurrency: WORKER_CONCURRENCY`
  (default 5), so that many jobs can be in-flight at once across however
  many worker processes you run.
- **Minimum delay between sends** — enforced via BullMQ's own rate limiter
  on the `Worker`: `limiter: { max: 1, duration: MIN_DELAY_BETWEEN_EMAILS_MS }`
  (default **2000 ms**). This is tracked in Redis, so it's a real *global*
  throttle on how fast jobs start across every worker instance reading the
  queue — not an in-memory setting that would break the moment you scale to
  a second worker process.
- **Emails per hour, per sender** — `src/queue/rateLimiter.ts` reserves a
  "send slot" atomically with a small Lua script: `INCR` a Redis key scoped
  to `sender:hourWindow`, set a 1-hour TTL on first increment, and compare
  against the sender's configured limit — all inside one Redis round trip,
  so it's safe under concurrent workers (no in-memory counters, no
  read-then-write race). When the cap is hit, the job is **not** failed or
  dropped: the worker calls `job.moveToDelayed(nextHourTimestamp, token)`
  and throws BullMQ's `DelayedError`, which re-queues it for the start of
  the next hour window while leaving its place in the (delayed-job) sort
  order intact relative to other jobs headed for that same window — this
  was verified directly: with a 3/hour cap and 5 queued emails, exactly 3
  sent and 2 were deferred with a logged "hit its 3/hr cap, deferring…"
  message, never marked failed.
- **Slack alert** — the same rate-limit check fires a live webhook POST via
  `notifyRateLimitHit`, gated by a Redis `SETNX`-style flag
  (`shouldNotifySlackForWindow`) so a burst of throttled jobs only pings
  Slack once per `(sender, hour)`, not once per job.

**Trade-off worth calling out:** the hourly counters and the
already-notified flag live only in Redis (not Postgres), because they're
short-lived (1-hour TTL) and re-deriving "how many did we send this hour"
from Postgres on every job would mean an extra DB query per send. The
practical effect, also verified in testing, is that a *catastrophic* Redis
data loss resets the current hour's count to zero (Postgres still
guarantees no email is lost or duplicated — it just means the in-flight
hour's rate limit restarts). Given Redis is normally persisted (AOF) this is
a deliberately accepted edge case rather than an oversight.

## Behavior under load (1000+ emails)

- Scheduling a large batch uses `prisma.email.createMany` (one INSERT) and
  `queue.addBulk` (one Redis round trip for the whole batch) instead of N
  individual calls, so scheduling 1000+ emails "for roughly the same time"
  doesn't mean 1000 sequential DB/Redis round trips.
- Actually *sending* them is still governed by the same concurrency +
  min-delay + hourly-cap rules above: BullMQ's delayed set holds all 1000+
  jobs fine (it's just a Redis sorted set), and they drain at whatever rate
  `WORKER_CONCURRENCY` / `MIN_DELAY_BETWEEN_EMAILS_MS` / the per-sender
  hourly cap allow — overflow beyond the cap rolls into subsequent hour
  windows automatically rather than erroring out.

## API reference

All routes except `/healthz`, `/api/auth/google` and `/api/slack/callback`
require `Authorization: Bearer <token>` (issued by `POST /api/auth/google`).

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/google` | Verify a Google ID token, upsert the user, issue a session JWT |
| GET | `/api/auth/me` | Current user |
| GET | `/api/senders` | List the user's sender identities |
| POST | `/api/senders` | Create a new Ethereal-backed sender |
| POST | `/api/emails/upload` | Parse a CSV/text file of leads → email list |
| POST | `/api/emails/schedule` | Schedule a batch of emails |
| GET | `/api/emails/scheduled` | Paginated list of `SCHEDULED`/`SENDING` emails |
| GET | `/api/emails/sent` | Paginated list of `SENT`/`FAILED` emails |
| GET | `/api/emails/search?q=` | Elasticsearch search (Postgres fallback if ES is down) |
| GET | `/api/slack/connect` | Redirect into Slack OAuth |
| GET | `/api/slack/callback` | Slack OAuth callback |
| GET | `/api/slack/status` | Whether Slack is connected |
| POST | `/api/slack/disconnect` | Remove the Slack integration |
| GET | `/admin/queues` | Bull Board (basic auth) |

## Known trade-offs / shortcuts

- **Ethereal account creation couldn't be live-verified from the build
  sandbox** — its egress network policy didn't allow the
  `api.nodemailer.com` host `nodemailer.createTestAccount()` calls out to
  (a sandbox restriction, not a code issue). The full pipeline was instead
  verified against a tiny local fake-SMTP server implementing the same
  protocol nodemailer speaks (EHLO/MAIL/RCPT/DATA/QUIT) standing in for
  Ethereal's real one — the send code path (`src/services/mailer.ts`) is
  identical either way; only the SMTP host/port differ. In a normal
  environment with outbound internet access, `npm run seed` / "+ Add
  sender" in the compose modal will reach Ethereal directly and every sent
  email will carry a real `previewUrl`.
- **Google OAuth / Slack OAuth** need real Client ID/Secret pairs from the
  person running this to actually complete a login/connect flow (as they
  would for any app) — the verification/exchange code itself is real, not
  mocked, and was reviewed carefully but couldn't be exercised end-to-end
  without registering throwaway OAuth apps for a sandboxed session.
- **Elasticsearch** wasn't spun up in the sandbox (needs a JVM-backed
  service; the code path was validated by inspection plus the graceful
  degrade actually engaging in testing — the API happily starts and search
  falls back to Postgres `ILIKE` with a logged warning). `docker-compose up`
  brings up a real single-node ES 8.x cluster.
- **Rate-limit counters are Redis-only** (see the trade-off note above) —
  accepted because Redis persistence (AOF) is enabled by default and the
  window is only ever an hour wide.
- **Slack "once per hour" notification key is per sender**, not per
  (sender, specific overflowing batch) — a second unrelated batch hitting
  the same sender's cap in the same hour won't re-notify; this matches "warn
  once, don't spam" rather than "warn once per campaign."
- **Multer 1.x** (used for the CSV upload endpoint) has a known advisory
  around malformed multipart bodies in older releases; acceptable here since
  the endpoint is behind auth and only accepts a single small file, but
  worth a `multer@2` upgrade before any real production use.
- **Next.js is pinned to the 14.2.x line** (latest patch, `14.2.35`) to stay
  compatible with `next-auth` v4's App Router support; a few advisories in
  that line are only fully resolved in Next 15/16, which would require
  migrating to Auth.js v5 as well. Deferred as a follow-up rather than risking
  breaking the login flow under a rushed major-version bump.
- **Session tokens** are a simple backend-issued JWT (`Authorization:
  Bearer`) rather than a full refresh-token/rotation scheme — appropriately
  scoped for this assignment's size; the Slack "Connect" link additionally
  accepts the token as a query param (documented in
  `src/middleware/requireAuth.ts`) since a top-level browser redirect can't
  carry a custom header.
- **Two DB failure states can only be told apart by request context**: an
  invalid sender/recipient still returns a 400 rather than partially
  scheduling a batch — schedule requests are all-or-nothing.
