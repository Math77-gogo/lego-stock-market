# Deployment

Three pieces: **Supabase** (database + auth), the **web app** (any Next.js host, e.g. Vercel), and the **sync worker**
(a long-running container on a host with a **static outbound IP**).

## 1. Supabase

1. Create a project at supabase.com (choose a Canadian or nearby region).
2. Apply the schema. From your machine, with the project's **direct** connection string (Settings → Database):
   ```bash
   DATABASE_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate
   ```
   Do **not** pass `--local-shim` here; Supabase already provides `auth.users`, `auth.uid()` and the roles.
3. Authentication → Providers: keep Email enabled. Authentication → URL configuration: set the Site URL to your web
   app's URL and add `https://<your-app>/auth/callback` to the redirect URLs.
4. Keep `app_settings.environment = 'production'` (the default). This makes Postgres reject any non-BrickLink market row.

## 2. BrickLink API credentials

1. You need a BrickLink account with seller status (BrickLink requires it for API access).
2. Go to https://www.bricklink.com/v2/api/register_consumer.page and register a consumer. You get a **consumer key** and **secret**.
3. Create an **access token**. BrickLink asks for the **IP address** allowed to use it. Enter the worker's static outbound IP (step 4).
   Requests from any other IP are rejected with an OAuth error, which the app reports as "Credentials rejected".
4. Read BrickLink's API terms of use (https://www.bricklink.com/v3/api.page) and confirm your intended use, including showing
   catalog images, is allowed.

Put the four values only in the worker's environment:
`BRICKLINK_CONSUMER_KEY`, `BRICKLINK_CONSUMER_SECRET`, `BRICKLINK_TOKEN_VALUE`, `BRICKLINK_TOKEN_SECRET`.

## 3. Web app (Vercel or similar)

Environment variables:

| Name                                                        | Value                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `APP_MODE`                                                  | `production`                                              |
| `DATABASE_URL`                                              | Supabase **transaction pooler** URL (port 6543)           |
| `DATABASE_POOL_MAX`                                         | `3`                                                       |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → Settings → API                            |
| `WORKER_INTERNAL_URL`                                       | Public HTTPS URL of the worker                            |
| `WORKER_API_SECRET`                                         | Same random secret as the worker (`openssl rand -hex 32`) |
| `SYNC_STALE_AFTER_HOURS`, `BRICKLINK_DAILY_REQUEST_LIMIT`   | Same values as the worker (display only)                  |

Do **not** set BrickLink credentials or `LOCAL_DEV_AUTH_USER_ID` on the web app. Build command `npm run build`, start `npm start`.
The web app needs no static IP: it never calls BrickLink.

## 4. Sync worker (needs a static outbound IP)

BrickLink tokens are bound to one IP, so the worker must always leave the internet from the same address.
**Verify this with your provider before choosing it**; many serverless and container platforms use shared, changing egress IPs.

Simplest verifiable option: a small VM with a dedicated public IPv4 (for example a DigitalOcean Droplet, Hetzner Cloud server,
AWS Lightsail instance, or an EC2 instance with an Elastic IP). Its public IP is your outbound IP.
Container platforms may offer static egress as a paid add-on; check the current documentation of the one you use.

On the VM (Docker installed):

```bash
git clone <your-repo> lego-stock-market
```

```bash
cd lego-stock-market && docker build -f Dockerfile.worker -t lsm-worker .
```

Create `/etc/lsm-worker.env` (permissions 600) with: `APP_MODE=production`, `DATABASE_URL` (Supabase **session pooler** or direct
URL, port 5432), the four `BRICKLINK_*` credentials, `WORKER_API_SECRET`, and optionally the `SYNC_*` / `BRICKLINK_*` tuning values
from `.env.example`.

```bash
docker run -d --name lsm-worker --restart unless-stopped --env-file /etc/lsm-worker.env -p 8080:8080 lsm-worker
```

Check the outbound IP the worker uses (register this one with BrickLink):

```bash
docker exec lsm-worker wget -qO- https://api.ipify.org
```

Expose port 8080 over HTTPS for `WORKER_INTERNAL_URL` (for example Caddy as a reverse proxy with automatic TLS). Every endpoint
except `/health` requires the bearer secret.

Logs are structured JSON on stdout and never contain credentials:

```bash
docker logs -f lsm-worker
```

### Starting continuous synchronization

The worker starts syncing on boot and then every `SYNC_TICK_SECONDS`. Add your first set from the app's Market page
(exact BrickLink number, e.g. `75192-1`); the worker fetches its catalog entry and first New/Used prices immediately.
Settings → BrickLink synchronization shows connection status, last and next sync, request usage and recent runs.

Cron-only platforms can run one cycle per invocation instead:

```bash
npm run worker:once
```

## 5. Optional: full catalog search

Download BrickLink's catalog (bricklink.com → Catalog → Download → Item Type "Sets", "Tab-Delimited File"), then:

```bash
DATABASE_URL="<direct url>" npm run catalog:import -- ./Sets.txt
```

Imported sets are searchable by name and theme and cost no API requests until someone opens or adds one.

## Quota

The default plan is 5,000 requests per day. Each tracked set uses up to 4 targets (New/Used × sold/listings). The scheduler
reserves 15% for lookups and spreads the rest: held sets' sold prices refresh most often (minimum 30 min), listings and
non-held sets 3–6× less often. Rate limits or auth failures pause the worker and are shown in Settings.
