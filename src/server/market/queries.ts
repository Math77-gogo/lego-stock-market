import type { Db } from "../db/context";
import type { Condition } from "../bricklink/types";
import { getSetById, type LegoSet } from "../catalog/service";
import {
  latestObservations,
  observationSeries,
  recentSales,
  type StoredObservation,
} from "./repository";
import {
  changeOverPeriod,
  referencePrice,
  soldSeries,
  type Change,
  type EngineOptions,
  type ReferencePrice,
  type SeriesPoint,
} from "../pricing/engine";

const DAY = 86_400_000;
export const PERIODS = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  "3M": 90 * DAY,
  "6M": 180 * DAY,
  "1Y": 365 * DAY,
} as const;
export type PeriodKey = keyof typeof PERIODS;

export interface ObservationSummary {
  qtyAvgPrice: number | null;
  avgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  unitQuantity: number | null;
  totalQuantity: number | null;
  currencyCode: string;
  observedAt: string;
}

const summarize = (o: StoredObservation | undefined): ObservationSummary | null =>
  o
    ? {
        qtyAvgPrice: o.qtyAvgPrice,
        avgPrice: o.avgPrice,
        minPrice: o.minPrice,
        maxPrice: o.maxPrice,
        unitQuantity: o.unitQuantity,
        totalQuantity: o.totalQuantity,
        currencyCode: o.currencyCode,
        observedAt: o.observedAt.toISOString(),
      }
    : null;

export interface ConditionMarket {
  reference: ReferencePrice;
  sold: ObservationSummary | null;
  stock: ObservationSummary | null;
  series: SeriesPoint[];
  observationCount: number;
  firstObservedAt: string | null;
  changes: Record<"1D" | "1W" | "1M", Change | null>;
  recentSales: { quantity: number; unitPrice: number; dateOrdered: string; currency: string }[];
}

export interface SetPageData {
  set: LegoSet;
  markets: Record<Condition, ConditionMarket>;
  lastSyncAt: string | null;
}

function changesFor(series: SeriesPoint[], ref: ReferencePrice): ConditionMarket["changes"] {
  // Never show a change computed from a stale "latest" point as if it were current.
  if (ref.price === null || ref.isStale) return { "1D": null, "1W": null, "1M": null };
  return {
    "1D": changeOverPeriod(series, PERIODS["1D"]),
    "1W": changeOverPeriod(series, PERIODS["1W"]),
    "1M": changeOverPeriod(series, PERIODS["1M"]),
  };
}

export async function getSetPageData(
  db: Db,
  setId: string,
  mode: "production" | "test",
  engine: EngineOptions,
): Promise<SetPageData | null> {
  const set = await getSetById(db, setId);
  if (!set) return null;
  const now = new Date();
  const [sold, stock, series, salesN, salesU, sync] = await Promise.all([
    latestObservations(db, [setId], "sold", mode),
    latestObservations(db, [setId], "stock", mode),
    observationSeries(db, [setId], "sold", null, mode),
    recentSales(db, setId, "N", mode),
    recentSales(db, setId, "U", mode),
    db.query<{ t: Date | null }>(
      "select max(last_success_at) as t from public.sync_targets where lego_set_id = $1",
      [setId],
    ),
  ]);
  const build = (c: Condition, sales: ConditionMarket["recentSales"]): ConditionMarket => {
    const latest = sold.get(`${setId}:${c}`);
    const ref = referencePrice(latest, now, engine);
    const all = series.get(`${setId}:${c}`) ?? [];
    const points = soldSeries(all, engine.currency);
    return {
      reference: ref,
      sold: summarize(latest),
      stock: summarize(stock.get(`${setId}:${c}`)),
      series: points,
      observationCount: all.length,
      firstObservedAt: all[0]?.observedAt.toISOString() ?? null,
      changes: changesFor(points, ref),
      recentSales: sales,
    };
  };
  return {
    set,
    markets: { N: build("N", salesN), U: build("U", salesU) },
    lastSyncAt: sync.rows[0]?.t?.toISOString() ?? null,
  };
}

export interface MarketRow {
  set: LegoSet;
  byCondition: Record<
    Condition,
    {
      price: number | null;
      status: ReferencePrice["status"];
      unitsSold: number | null;
      changes: ConditionMarket["changes"];
      observedAt: string | null;
    }
  >;
}

export async function marketRows(
  db: Db,
  sets: LegoSet[],
  mode: "production" | "test",
  engine: EngineOptions,
): Promise<MarketRow[]> {
  const ids = sets.map((s) => s.id);
  const now = new Date();
  const [latest, series] = await Promise.all([
    latestObservations(db, ids, "sold", mode),
    observationSeries(db, ids, "sold", new Date(now.getTime() - 46 * DAY), mode),
  ]);
  return sets.map((set) => {
    const one = (c: Condition) => {
      const ref = referencePrice(latest.get(`${set.id}:${c}`), now, engine);
      const points = soldSeries(series.get(`${set.id}:${c}`) ?? [], engine.currency);
      return {
        price: ref.price,
        status: ref.status,
        unitsSold: ref.unitsSold,
        changes: changesFor(points, ref),
        observedAt: ref.observedAt?.toISOString() ?? null,
      };
    };
    return { set, byCondition: { N: one("N"), U: one("U") } };
  });
}

export interface LeaderboardEntry {
  set: LegoSet;
  condition: Condition;
  price: number;
  change: Change | null;
  unitsSold: number | null;
  observations: number;
  observedAt: string;
}

/** Rankings use only collected BrickLink observations; sets without enough history are excluded. */
export async function leaderboard(
  db: Db,
  mode: "production" | "test",
  engine: EngineOptions,
  period: PeriodKey,
): Promise<{ entries: LeaderboardEntry[]; excluded: number }> {
  const now = new Date();
  const setsRes = await db.query<{ id: string }>("select id from public.lego_sets where tracked");
  const ids = setsRes.rows.map((r) => r.id);
  const since = new Date(now.getTime() - PERIODS[period] * 1.6);
  const [latest, series] = await Promise.all([
    latestObservations(db, ids, "sold", mode),
    observationSeries(db, ids, "sold", since, mode),
  ]);
  const entries: LeaderboardEntry[] = [];
  let excluded = 0;
  const setCache = new Map<string, LegoSet>();
  for (const [key, obs] of latest) {
    const [setId, condition] = key.split(":") as [string, Condition];
    const ref = referencePrice(obs, now, engine);
    if (ref.price === null || ref.isStale) {
      excluded++;
      continue;
    }
    const all = series.get(key) ?? [];
    const change = changeOverPeriod(soldSeries(all, engine.currency), PERIODS[period]);
    let set = setCache.get(setId);
    if (!set) {
      set = (await getSetById(db, setId)) ?? undefined;
      if (!set) continue;
      setCache.set(setId, set);
    }
    if (!change) excluded++;
    entries.push({
      set,
      condition,
      price: ref.price,
      change,
      unitsSold: ref.unitsSold,
      observations: all.length,
      observedAt: obs.observedAt.toISOString(),
    });
  }
  return { entries, excluded };
}

export interface SyncStatus {
  connectionStatus: string;
  heartbeatAt: string | null;
  lastSuccessAt: string | null;
  nextSyncAt: string | null;
  intervalSeconds: number | null;
  lastError: string | null;
  pausedUntil: string | null;
  requests24h: number;
  dailyLimit: number;
  trackedSets: number;
  targetsOk: number;
  targetsFailing: number;
  recentRuns: {
    id: number;
    startedAt: string;
    completedAt: string | null;
    status: string;
    requestsUsed: number;
    setsUpdated: number;
    setsFailed: number;
  }[];
}

export async function syncStatus(db: Db, dailyLimit: number): Promise<SyncStatus> {
  const [ws, req, sets, targets, runs] = await Promise.all([
    db.query("select * from public.worker_status where id = 1"),
    db.query<{ n: number }>(
      "select count(*)::int as n from public.bricklink_api_requests where requested_at > now() - interval '24 hours'",
    ),
    db.query<{ n: number }>("select count(*)::int as n from public.lego_sets where tracked"),
    db.query<{ ok: number; failing: number }>(
      "select count(*) filter (where consecutive_failures = 0 and last_success_at is not null)::int as ok, count(*) filter (where consecutive_failures > 0)::int as failing from public.sync_targets",
    ),
    db.query(
      "select id, started_at, completed_at, status, requests_used, sets_updated, sets_failed from public.sync_runs order by started_at desc limit 8",
    ),
  ]);
  const w = ws.rows[0] ?? {};
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  // A worker that has not reported for 10 minutes is not running, whatever its last status said.
  const heartbeat = w.heartbeat_at ? new Date(w.heartbeat_at).getTime() : 0;
  const offline = Date.now() - heartbeat > 10 * 60_000;
  return {
    connectionStatus: offline ? "worker_offline" : (w.connection_status ?? "unknown"),
    heartbeatAt: iso(w.heartbeat_at),
    lastSuccessAt: iso(w.last_success_at),
    nextSyncAt: offline ? null : iso(w.next_sync_at),
    intervalSeconds: w.interval_seconds ?? null,
    lastError: w.last_error ?? null,
    pausedUntil: iso(w.paused_until),
    requests24h: req.rows[0]?.n ?? 0,
    dailyLimit,
    trackedSets: sets.rows[0]?.n ?? 0,
    targetsOk: targets.rows[0]?.ok ?? 0,
    targetsFailing: targets.rows[0]?.failing ?? 0,
    recentRuns: runs.rows.map((r) => ({
      id: r.id,
      startedAt: iso(r.started_at)!,
      completedAt: iso(r.completed_at),
      status: r.status,
      requestsUsed: r.requests_used,
      setsUpdated: r.sets_updated,
      setsFailed: r.sets_failed,
    })),
  };
}
