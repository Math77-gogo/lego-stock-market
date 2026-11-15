# LEGO Stock Market

Track a LEGO collection like a stock portfolio. Every set and condition (New/Sealed, Used) is its own
position, valued in **CAD** from the official **BrickLink API**, and nothing else.

## Architecture

```
┌─────────────────────┐      server actions      ┌──────────────────────────┐
│ Next.js web app/PWA │ ───── (RLS as user) ───▶ │ Postgres (Supabase)      │
│ app/, src/components│                          │ supabase/migrations      │
└─────────┬───────────┘                          └──────────▲───────────────┘
          │ POST /internal/catalog/lookup (bearer secret)   │ observations, snapshots,
          ▼                                                 │ sync logs, quota ledger
┌─────────────────────┐   OAuth 1.0a, CAD, quota-aware      │
│ Sync worker (Node)  │ ──────────────────────────────▶ BrickLink API v1
│ worker/index.ts     │ ────────────────────────────────────┘
└─────────────────────┘
```

- **The worker is the only process that talks to BrickLink.** One outbound IP to register, one quota counter.
  It runs continuously whether or not anyone has the app open.
- **The web app never holds BrickLink credentials.** It reads stored observations and asks the worker for catalog lookups.
- **Every user query runs as the Postgres `authenticated` role with Row Level Security**, the same model as
  Supabase's own API. One user cannot see or change another user's portfolio even if app code had a bug.

| Layer                                                               | Path                                             |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| BrickLink API service (OAuth 1.0a, typed errors, schema validation) | `src/server/bricklink/`                          |
| Market data storage and reads                                       | `src/server/market/repository.ts`, `queries.ts`  |
| Price calculation engine (pure, unit-tested)                        | `src/server/pricing/engine.ts`                   |
| Portfolio service (lots, FIFO, transactions, snapshots)             | `src/server/portfolio/service.ts`                |
| Sync scheduler (pure) and engine                                    | `src/server/sync/`                               |
| Authentication                                                      | `src/server/auth/`, `middleware.ts`, `app/login` |
| UI                                                                  | `app/`, `src/components/`                        |

## BrickLink-only, enforced in code and in the database

- Observations table: `source` must be `bricklink_api_v1` (a trigger also rejects anything else when the DB is in production).
  Observations are immutable (an update trigger raises).
- Market reads in production filter to `source = 'bricklink_api_v1'`.
- The mock BrickLink transport used by tests throws if constructed in production mode.
- No other price source, scraper, or currency converter exists in the codebase.

## How prices are computed

- **Reference price** = BrickLink Price Guide `qty_avg_price`, `guide_type=sold`, for the position's own condition,
  requested with `currency_code=CAD`. Asking prices (`guide_type=stock`) are shown separately and never used for valuation.
- No sales, a missing value, or a non-CAD response → **"Insufficient BrickLink data"**; the position is excluded from totals
  and the dashboard says so.
- Prices older than `SYNC_STALE_AFTER_HOURS` are flagged with their age and excluded from "today" and rankings.
- **Charts** plot only observations this app collected. Each point is BrickLink's trailing 6-month aggregate _as observed
  at that time_; this is stated under every chart. With 3 days of data, 1M shows "Not enough historical data".
- Changes (24 h / 7 d / 30 d …) need a real observation near the start of the period, or they show "—".
- Lots are BUY transactions; sales consume lots FIFO. Realized P/L = proceeds − fees − FIFO cost.

## Known BrickLink API limits and what the app does instead

| Requirement                      | API reality                                                          | Implementation                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Search the catalog by name/theme | The API has **no keyword search**; items are fetched by exact number | Exact-number lookup through the worker, plus `npm run catalog:import` for BrickLink's official catalog download file, searchable locally |
| Daily price history              | Price Guide returns a 6-month **aggregate**, not a daily feed        | The worker stores every response with a timestamp; charts are built from those                                                           |
| "Live" market                    | 5,000 requests/day (default limit)                                   | Adaptive interval: held sets first, then stock guides and other tracked sets; budget reserve for lookups                                 |
| Images                           | `image_url` from the catalog                                         | Hot-linked from `img.bricklink.com`, not re-hosted. Confirm BrickLink's terms allow your use                                             |

## Local development

Requires Node 22 and PostgreSQL 16.

```bash
npm install
```

```bash
cp .env.example .env.local   # then fill in values
```

Without Supabase, a local database plus a fixed dev user works:

```bash
createdb lsm_dev
```

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/lsm_dev npm run db:migrate -- --local-shim
```

Optional TEST MODE fixtures (UI work without BrickLink access; mark the DB as a test DB first, the app shows a TEST MODE banner):

```bash
psql "$DATABASE_URL" -c "update app_settings set value='\"test\"' where key='environment'"
```

```bash
APP_MODE=test DATABASE_URL=postgres://postgres:postgres@localhost:5432/lsm_dev npx tsx scripts/seed-test-data.ts 11111111-1111-4111-8111-111111111111
```

Then set `APP_MODE=test` and `LOCAL_DEV_AUTH_USER_ID=11111111-1111-4111-8111-111111111111` in `.env.local` and run:

```bash
npm run dev
```

## Tests

```bash
npm test
```

Unit tests cover the OAuth signer (against a published reference vector), the BrickLink client, the price engine and the scheduler.
Integration tests run against a real Postgres (`TEST_DATABASE_URL`, default `postgres://postgres:postgres@localhost:5432/lsm_test`; the
helper refuses any database whose name doesn't contain `test`): RLS isolation, BrickLink-only triggers, the worker end to end with a
mock BrickLink, failures, rate limits, quota, and every portfolio mutation.

`npm run verify` runs typecheck, lint, tests and the production build.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
