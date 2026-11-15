-- LEGO STOCK MARKET — initial schema
-- All timestamps are timestamptz (stored in UTC).
-- Market data rule: every market observation must come from the official BrickLink API.
-- This is enforced by CHECK constraints and a trigger, not only by application code.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- App settings (environment guard)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- 'production' blocks every non-BrickLink row. Test databases set this to 'test'.
insert into public.app_settings (key, value) values ('environment', '"production"');

create or replace function public.app_environment() returns text
language sql stable as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'environment'), 'production')
$$;

-- ---------------------------------------------------------------------------
-- Users (mirror of auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email) on conflict (id) do nothing;
  insert into public.portfolios (user_id, name) values (new.id, 'My LEGO Portfolio');
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Catalog (BrickLink catalog items)
-- ---------------------------------------------------------------------------
create table public.lego_sets (
  id uuid primary key default gen_random_uuid(),
  bricklink_item_type text not null
    check (bricklink_item_type in ('SET','MINIFIG','PART','BOOK','GEAR','CATALOG','INSTRUCTION','UNSORTED_LOT','ORIGINAL_BOX')),
  bricklink_item_number text not null check (length(bricklink_item_number) between 1 and 64),
  name text not null,
  category_id integer,
  theme text,
  year_released integer,
  image_url text,
  thumbnail_url text,
  is_obsolete boolean,
  catalog_source text not null default 'bricklink_api_v1'
    check (catalog_source in ('bricklink_api_v1', 'bricklink_catalog_download', 'test_fixture')),
  catalog_fetched_at timestamptz not null default now(),
  tracked boolean not null default true,
  created_at timestamptz not null default now(),
  unique (bricklink_item_type, bricklink_item_number)
);
create index lego_sets_name_trgm on public.lego_sets using gin (name gin_trgm_ops);
create index lego_sets_theme_idx on public.lego_sets (theme);
create index lego_sets_number_idx on public.lego_sets (bricklink_item_number text_pattern_ops);

create table public.bricklink_categories (
  category_id integer primary key,
  category_name text not null,
  parent_id integer,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Portfolios
-- ---------------------------------------------------------------------------
create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  base_currency char(3) not null default 'CAD',
  created_at timestamptz not null default now()
);
create index portfolios_user_idx on public.portfolios (user_id);

-- One holding = one market position = one set in ONE condition.
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  lego_set_id uuid not null references public.lego_sets (id) on delete restrict,
  condition char(1) not null check (condition in ('N','U')),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  unique (portfolio_id, lego_set_id, condition)
);
create index holdings_set_idx on public.holdings (lego_set_id, condition);

-- Every buy is an acquisition lot; every sell consumes lots FIFO (computed by the engine).
create table public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references public.holdings (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  transaction_type text not null check (transaction_type in ('BUY','SELL')),
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  fees numeric(12,2) not null default 0 check (fees >= 0),
  currency char(3) not null default 'CAD',
  transaction_date date not null,
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index portfolio_transactions_holding_idx on public.portfolio_transactions (holding_id, transaction_date, created_at);
create index portfolio_transactions_user_idx on public.portfolio_transactions (user_id);

-- Acquisition lots view: each BUY transaction is a lot.
create view public.acquisition_lots with (security_invoker = true) as
  select t.id, t.holding_id, t.quantity, t.unit_price as unit_purchase_price,
         t.fees, t.transaction_date as acquisition_date, t.currency
  from public.portfolio_transactions t
  where t.transaction_type = 'BUY';

-- ---------------------------------------------------------------------------
-- Sync runs (SYNC_LOGS)
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed','skipped')),
  trigger text not null default 'schedule',
  requests_used integer not null default 0,
  sets_updated integer not null default 0,
  sets_failed integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  note text
);
create index sync_runs_started_idx on public.sync_runs (started_at desc);

-- Every HTTP request sent to BrickLink, for quota accounting.
create table public.bricklink_api_requests (
  id bigserial primary key,
  requested_at timestamptz not null default now(),
  method text not null,
  endpoint text not null,
  http_status integer,
  bricklink_code integer,
  duration_ms integer,
  ok boolean not null,
  sync_run_id bigint references public.sync_runs (id) on delete set null
);
create index bricklink_api_requests_time_idx on public.bricklink_api_requests (requested_at desc);

-- ---------------------------------------------------------------------------
-- BrickLink price observations
-- guide_type 'sold'  = BrickLink Price Guide, completed sales, last 6 months (aggregate)
-- guide_type 'stock' = BrickLink Price Guide, current for-sale listings (asking prices)
-- One row = one API response for one set, ONE condition, ONE guide type.
-- ---------------------------------------------------------------------------
create table public.bricklink_price_observations (
  id bigserial primary key,
  lego_set_id uuid not null references public.lego_sets (id) on delete cascade,
  condition char(1) not null check (condition in ('N','U')),
  guide_type text not null check (guide_type in ('sold','stock')),
  avg_price numeric(14,4),
  qty_avg_price numeric(14,4),
  min_price numeric(14,4),
  max_price numeric(14,4),
  unit_quantity integer check (unit_quantity >= 0),
  total_quantity integer check (total_quantity >= 0),
  currency_code char(3) not null,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('bricklink_api_v1', 'test_fixture')),
  request_params jsonb not null default '{}'::jsonb,
  raw_response jsonb,
  sync_run_id bigint references public.sync_runs (id) on delete set null
);
create index bpo_series_idx on public.bricklink_price_observations (lego_set_id, condition, guide_type, observed_at desc);
create index bpo_observed_idx on public.bricklink_price_observations (observed_at desc);

create or replace function public.enforce_bricklink_only_observation() returns trigger
language plpgsql as $$
begin
  if public.app_environment() = 'production' and new.source <> 'bricklink_api_v1' then
    raise exception 'Only official BrickLink API observations are allowed in production (got source=%)', new.source;
  end if;
  return new;
end $$;

create or replace function public.enforce_bricklink_only_catalog() returns trigger
language plpgsql as $$
begin
  if public.app_environment() = 'production' and new.catalog_source = 'test_fixture' then
    raise exception 'Test fixture catalog rows are not allowed in production';
  end if;
  return new;
end $$;

create trigger bpo_bricklink_only before insert or update on public.bricklink_price_observations
  for each row execute function public.enforce_bricklink_only_observation();
create trigger lego_sets_bricklink_only before insert or update on public.lego_sets
  for each row execute function public.enforce_bricklink_only_catalog();

-- Observations are an append-only historical record.
create or replace function public.prevent_observation_update() returns trigger
language plpgsql as $$
begin
  raise exception 'BrickLink observations are immutable';
end $$;
create trigger bpo_immutable before update on public.bricklink_price_observations
  for each row execute function public.prevent_observation_update();

-- ---------------------------------------------------------------------------
-- Sync targets (scheduler state: one row per set × condition × guide type)
-- ---------------------------------------------------------------------------
create table public.sync_targets (
  lego_set_id uuid not null references public.lego_sets (id) on delete cascade,
  condition char(1) not null check (condition in ('N','U')),
  guide_type text not null check (guide_type in ('sold','stock')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_due_at timestamptz not null default now(),
  consecutive_failures integer not null default 0,
  last_error text,
  primary key (lego_set_id, condition, guide_type)
);
create index sync_targets_due_idx on public.sync_targets (next_due_at);

-- Worker status (heartbeat, next scheduled run, current interval)
create table public.worker_status (
  id smallint primary key default 1 check (id = 1),
  heartbeat_at timestamptz,
  next_sync_at timestamptz,
  interval_seconds integer,
  connection_status text not null default 'unknown'
    check (connection_status in ('unknown','connected','degraded','unavailable','unauthorized','rate_limited','not_configured')),
  last_success_at timestamptz,
  last_error text,
  paused_until timestamptz,
  details jsonb not null default '{}'::jsonb
);
insert into public.worker_status (id) values (1);

-- ---------------------------------------------------------------------------
-- Portfolio value snapshots (written by the worker after each sync)
-- ---------------------------------------------------------------------------
create table public.portfolio_value_snapshots (
  id bigserial primary key,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  captured_at timestamptz not null default now(),
  market_value numeric(14,2) not null,
  cost_basis numeric(14,2) not null,
  unrealized_pl numeric(14,2) not null,
  realized_pl numeric(14,2) not null,
  priced_positions integer not null,
  unpriced_positions integer not null,
  currency char(3) not null default 'CAD'
);
create index pvs_portfolio_time_idx on public.portfolio_value_snapshots (portfolio_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.portfolios enable row level security;
alter table public.holdings enable row level security;
alter table public.portfolio_transactions enable row level security;
alter table public.portfolio_value_snapshots enable row level security;
alter table public.lego_sets enable row level security;
alter table public.bricklink_categories enable row level security;
alter table public.bricklink_price_observations enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_targets enable row level security;
alter table public.worker_status enable row level security;
alter table public.bricklink_api_requests enable row level security;
alter table public.app_settings enable row level security;

create policy users_self on public.users for select to authenticated using (id = auth.uid());

create policy portfolios_owner on public.portfolios for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy holdings_owner on public.holdings for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

create policy transactions_owner on public.portfolio_transactions for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid() and exists (
      select 1 from public.holdings h join public.portfolios p on p.id = h.portfolio_id
      where h.id = holding_id and p.user_id = auth.uid()
    )
  );

create policy snapshots_owner on public.portfolio_value_snapshots for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = auth.uid()));

-- Public market data: readable by signed-in users, written only by the server/worker.
create policy lego_sets_read on public.lego_sets for select to authenticated using (true);
create policy categories_read on public.bricklink_categories for select to authenticated using (true);
create policy observations_read on public.bricklink_price_observations for select to authenticated using (true);
create policy sync_runs_read on public.sync_runs for select to authenticated using (true);
create policy sync_targets_read on public.sync_targets for select to authenticated using (true);
create policy worker_status_read on public.worker_status for select to authenticated using (true);
create policy api_requests_read on public.bricklink_api_requests for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.portfolios, public.holdings, public.portfolio_transactions to authenticated;
revoke all on public.app_settings from authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();
