/**
 * Seeds a LOCAL TEST database with clearly labelled fixture data (source = 'test_fixture') so the
 * interface can be developed and reviewed without BrickLink access.
 *
 * Safety: refuses to run unless APP_MODE=test AND the database itself is marked as a test
 * database (app_settings.environment = 'test'). Production databases reject fixture rows at the
 * trigger level anyway. The app shows a TEST MODE banner whenever APP_MODE=test.
 *
 *   APP_MODE=test DATABASE_URL=... npx tsx scripts/seed-test-data.ts <user-uuid>
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (process.env.APP_MODE !== "test") throw new Error("Refusing: APP_MODE must be 'test'");
const userId = process.argv[2];
if (!userId) throw new Error("Usage: seed-test-data.ts <user-uuid>");

const db = new pg.Client({ connectionString: url });
await db.connect();
const env = await db.query<{ e: string }>("select public.app_environment() as e");
if (env.rows[0]?.e !== "test")
  throw new Error("Refusing: this database is not marked as a test database");

// Deterministic pseudo-random walk (fixtures only, never shown outside TEST MODE).
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const SETS = [
  {
    no: "TEST-75192-1",
    name: "Test fixture · Large starship",
    theme: "Fixture Theme A",
    n: 1100,
    u: 840,
    drift: 0.0009,
  },
  {
    no: "TEST-10497-1",
    name: "Test fixture · Space explorer",
    theme: "Fixture Theme B",
    n: 150,
    u: 95,
    drift: 0.0015,
  },
  {
    no: "TEST-21318-1",
    name: "Test fixture · Tree house",
    theme: "Fixture Theme C",
    n: 330,
    u: 240,
    drift: -0.0004,
  },
  {
    no: "TEST-10305-1",
    name: "Test fixture · Lion castle",
    theme: "Fixture Theme B",
    n: 520,
    u: 0,
    drift: 0.0006,
  },
  {
    no: "TEST-42143-1",
    name: "Test fixture · Race car",
    theme: "Fixture Theme D",
    n: 610,
    u: 470,
    drift: -0.0011,
  },
];
const HOLD: { no: string; cond: "N" | "U"; qty: number; cost: number }[] = [
  { no: "TEST-75192-1", cond: "N", qty: 2, cost: 849.99 },
  { no: "TEST-75192-1", cond: "U", qty: 1, cost: 700 },
  { no: "TEST-10497-1", cond: "N", qty: 3, cost: 129.99 },
  { no: "TEST-21318-1", cond: "N", qty: 1, cost: 299.99 },
  { no: "TEST-10305-1", cond: "U", qty: 1, cost: 400 },
  { no: "TEST-42143-1", cond: "N", qty: 1, cost: 649.99 },
];

const STEP_H = 6;
const POINTS = (120 * 24) / STEP_H;
const now = Date.now();
const priceAt = new Map<string, number[]>();

await db.query("begin");
await db.query(
  "insert into auth.users (id, email) values ($1, 'test-user@localhost') on conflict do nothing",
  [userId],
);
const portfolio = await db.query<{ id: string }>(
  "select id from public.portfolios where user_id = $1 limit 1",
  [userId],
);
const portfolioId = portfolio.rows[0]!.id;

for (const s of SETS) {
  const set = await db.query<{ id: string }>(
    `insert into public.lego_sets (bricklink_item_type, bricklink_item_number, name, theme, year_released, catalog_source)
     values ('SET', $1, $2, $3, 2024, 'test_fixture')
     on conflict (bricklink_item_type, bricklink_item_number) do update set name = excluded.name returning id`,
    [s.no, s.name, s.theme],
  );
  const setId = set.rows[0]!.id;
  for (const cond of ["N", "U"] as const) {
    let p = cond === "N" ? s.n : s.u;
    const series: number[] = [];
    for (let i = 0; i < POINTS; i++) {
      const t = new Date(now - (POINTS - 1 - i) * STEP_H * 3600_000);
      p = p * (1 + s.drift + (rand() - 0.5) * 0.012);
      series.push(p);
      const units = p > 0 ? Math.round(5 + rand() * 40) : 0;
      await db.query(
        `insert into public.bricklink_price_observations
           (lego_set_id, condition, guide_type, avg_price, qty_avg_price, min_price, max_price, unit_quantity, total_quantity,
            currency_code, observed_at, source)
         values ($1,$2,'sold',$3,$4,$5,$6,$7,$8,'CAD',$9,'test_fixture')`,
        [setId, cond, p ? p * 1.01 : 0, p, p * 0.8, p * 1.25, units, units + 2, t],
      );
      if (i === POINTS - 1 && p > 0) {
        await db.query(
          `insert into public.bricklink_price_observations
             (lego_set_id, condition, guide_type, avg_price, qty_avg_price, min_price, max_price, unit_quantity, total_quantity,
              currency_code, observed_at, source)
           values ($1,$2,'stock',$3,$4,$5,$6,$7,$8,'CAD',$9,'test_fixture')`,
          [setId, cond, p * 1.18, p * 1.15, p * 0.95, p * 1.9, 14, 18, t],
        );
      }
    }
    priceAt.set(`${s.no}:${cond}`, series);
    await db.query(
      `insert into public.sync_targets (lego_set_id, condition, guide_type, last_attempt_at, last_success_at, next_due_at)
       values ($1,$2,'sold', now(), now(), now() + interval '30 minutes') on conflict do nothing`,
      [setId, cond],
    );
  }
  for (const h of HOLD.filter((x) => x.no === s.no)) {
    const holding = await db.query<{ id: string }>(
      `insert into public.holdings (portfolio_id, lego_set_id, condition) values ($1,$2,$3)
       on conflict (portfolio_id, lego_set_id, condition) do update set condition = excluded.condition returning id`,
      [portfolioId, setId, h.cond],
    );
    await db.query(
      `insert into public.portfolio_transactions (holding_id, user_id, transaction_type, quantity, unit_price, transaction_date)
       values ($1,$2,'BUY',$3,$4, (now() - interval '125 days')::date)`,
      [holding.rows[0]!.id, userId, h.qty, h.cost],
    );
  }
}

const cost = HOLD.reduce((s, h) => s + h.qty * h.cost, 0);
for (let i = 0; i < POINTS; i++) {
  let mv = 0;
  let unpriced = 0;
  for (const h of HOLD) {
    const p = priceAt.get(`${h.no}:${h.cond}`)![i]!;
    if (p > 0) mv += p * h.qty;
    else unpriced++;
  }
  await db.query(
    `insert into public.portfolio_value_snapshots (portfolio_id, captured_at, market_value, cost_basis, unrealized_pl, realized_pl, priced_positions, unpriced_positions)
     values ($1,$2,$3,$4,$5,0,$6,$7)`,
    [
      portfolioId,
      new Date(now - (POINTS - 1 - i) * STEP_H * 3600_000),
      mv.toFixed(2),
      cost.toFixed(2),
      (mv - cost).toFixed(2),
      HOLD.length - unpriced,
      unpriced,
    ],
  );
}
await db.query(
  `update public.worker_status set heartbeat_at = now(), last_success_at = now(), next_sync_at = now() + interval '30 minutes',
     interval_seconds = 1800, connection_status = 'connected' where id = 1`,
);
await db.query(
  "insert into public.sync_runs (completed_at, status, requests_used, sets_updated, trigger, note) values (now(), 'success', 20, 20, 'test_fixture', 'seed')",
);
await db.query("commit");
await db.end();
console.log(
  `Seeded ${SETS.length} fixture sets × ${POINTS} observations for user ${userId} (TEST MODE ONLY).`,
);
