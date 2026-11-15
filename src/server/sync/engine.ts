import type pg from "pg";
import { withSystem, type Db } from "../db/context";
import { BrickLinkClient, type Transport, type RequestLogEntry } from "../bricklink/client";
import { BrickLinkError } from "../bricklink/errors";
import type { Condition, GuideType, ItemType } from "../bricklink/types";
import { insertObservation } from "../market/repository";
import { writePortfolioSnapshots } from "../portfolio/service";
import { categoryName, findSet, normalizeSetNumber, upsertCatalogItem, type LegoSet } from "../catalog/service";
import { backoffSeconds, computeSyncPlan, type SyncPlan, type TargetClass } from "./scheduler";
import { bricklinkCredentials, type AppConfig } from "@/lib/config";
import type { EngineOptions } from "../pricing/engine";

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Structured JSON logs. Never logs credentials or OAuth headers. */
export const jsonLogger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), msg, ...data })),
  warn: (msg, data) => console.warn(JSON.stringify({ level: "warn", time: new Date().toISOString(), msg, ...data })),
  error: (msg, data) => console.error(JSON.stringify({ level: "error", time: new Date().toISOString(), msg, ...data })),
};

interface DueTarget {
  lego_set_id: string;
  condition: Condition;
  guide_type: GuideType;
  consecutive_failures: number;
  item_type: ItemType;
  item_number: string;
  held: boolean;
}

export interface CycleResult {
  runId: number | null;
  status: "success" | "partial" | "failed" | "skipped";
  requestsUsed: number;
  updated: number;
  failed: number;
  plan: SyncPlan | null;
  note?: string;
}

const CATALOG_MAX_AGE_DAYS = 30;

export class SyncEngine {
  private readonly client: BrickLinkClient;
  private runId: number | null = null;
  private requestsThisRun = 0;
  private responseTimes: number[] = [];

  constructor(
    private readonly pool: pg.Pool,
    private readonly cfg: AppConfig,
    private readonly log: Logger = jsonLogger,
    transport?: Transport,
  ) {
    this.client = new BrickLinkClient({
      baseUrl: cfg.BRICKLINK_API_BASE_URL,
      credentials: bricklinkCredentials(cfg),
      mode: cfg.APP_MODE,
      transport,
      timeoutMs: cfg.BRICKLINK_REQUEST_TIMEOUT_MS,
      minSpacingMs: cfg.BRICKLINK_MIN_REQUEST_SPACING_MS,
      beforeRequest: () => this.assertQuota(),
      onRequest: (e) => this.recordRequest(e),
    });
  }

  get engineOptions(): EngineOptions {
    return { currency: "CAD", staleAfterHours: this.cfg.SYNC_STALE_AFTER_HOURS, minUnitsForConfidence: 3 };
  }

  // -------------------------------------------------------------------------
  // Quota accounting
  // -------------------------------------------------------------------------

  async requestsLast24h(): Promise<number> {
    const r = await this.pool.query<{ n: number }>(
      "select count(*)::int as n from public.bricklink_api_requests where requested_at > now() - interval '24 hours'",
    );
    return r.rows[0]?.n ?? 0;
  }

  private async assertQuota(): Promise<void> {
    // The reserve stays available for on-demand catalog lookups from the app.
    const used = await this.requestsLast24h();
    if (used >= this.cfg.BRICKLINK_DAILY_REQUEST_LIMIT) {
      throw new BrickLinkError("quota_exhausted", "Daily BrickLink request budget is used up");
    }
  }

  private async recordRequest(e: RequestLogEntry): Promise<void> {
    this.requestsThisRun++;
    this.responseTimes.push(e.durationMs);
    if (this.responseTimes.length > 50) this.responseTimes.shift();
    await this.pool.query(
      `insert into public.bricklink_api_requests (method, endpoint, http_status, bricklink_code, duration_ms, ok, sync_run_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [e.method, e.endpoint, e.httpStatus ?? null, e.bricklinkCode ?? null, e.durationMs, e.ok, this.runId],
    );
  }

  private avgResponseMs(): number | null {
    if (this.responseTimes.length === 0) return null;
    return this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  // -------------------------------------------------------------------------
  // Catalog (on-demand lookups from the app go through the worker)
  // -------------------------------------------------------------------------

  async ensureCategories(): Promise<void> {
    const r = await this.pool.query<{ n: number; newest: Date | null }>(
      "select count(*)::int as n, max(fetched_at) as newest from public.bricklink_categories",
    );
    const row = r.rows[0];
    const fresh = row && row.n > 0 && row.newest && Date.now() - row.newest.getTime() < 7 * 86_400_000;
    if (fresh) return;
    const categories = await this.client.getCategories();
    await withSystem(async (db) => {
      for (const c of categories) {
        await db.query(
          `insert into public.bricklink_categories (category_id, category_name, parent_id, fetched_at)
           values ($1,$2,$3, now()) on conflict (category_id) do update set
             category_name = excluded.category_name, parent_id = excluded.parent_id, fetched_at = now()`,
          [c.category_id, c.category_name, c.parent_id ?? null],
        );
      }
    }, this.pool);
  }

  /** Returns the cached catalog item, or fetches it from BrickLink when missing or older than 30 days. */
  async lookupCatalogItem(type: ItemType, rawNumber: string): Promise<LegoSet> {
    const no = normalizeSetNumber(rawNumber, type);
    const cached = await withSystem((db) => findSet(db, type, no), this.pool);
    if (cached && Date.now() - cached.catalogFetchedAt.getTime() < CATALOG_MAX_AGE_DAYS * 86_400_000) {
      await this.pool.query("update public.lego_sets set tracked = true where id = $1", [cached.id]);
      await this.ensureTargets();
      return cached;
    }
    try {
      await this.ensureCategories();
    } catch (err) {
      this.log.warn("Could not refresh BrickLink categories", { error: (err as Error).message });
    }
    const item = await this.client.getItem(type, no);
    const set = await withSystem(async (db) => upsertCatalogItem(db, item, await categoryName(db, item.category_id)), this.pool);
    await this.ensureTargets();
    // Make new sets due immediately so the first price observation arrives quickly.
    await this.pool.query("update public.sync_targets set next_due_at = now() where lego_set_id = $1 and last_success_at is null", [set.id]);
    return set;
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /** One sync target per tracked set × condition × guide type. */
  async ensureTargets(): Promise<void> {
    const guides = this.cfg.SYNC_STOCK_GUIDE_ENABLED ? ["sold", "stock"] : ["sold"];
    await this.pool.query(
      `insert into public.sync_targets (lego_set_id, condition, guide_type)
       select s.id, c.condition, g.guide_type from public.lego_sets s
         cross join (values ('N'), ('U')) as c(condition)
         cross join unnest($1::text[]) as g(guide_type)
        where s.tracked
       on conflict do nothing`,
      [guides],
    );
    if (!this.cfg.SYNC_STOCK_GUIDE_ENABLED) {
      await this.pool.query("delete from public.sync_targets where guide_type = 'stock'");
    }
  }

  async plan(): Promise<SyncPlan> {
    const counts = await this.pool.query<{ cls: TargetClass; n: number }>(
      `select (case when exists (select 1 from public.holdings h where h.lego_set_id = t.lego_set_id)
                    then 'held_' else 'other_' end) || t.guide_type as cls, count(*)::int as n
         from public.sync_targets t group by 1`,
    );
    const c: Record<TargetClass, number> = { held_sold: 0, held_stock: 0, other_sold: 0, other_stock: 0 };
    for (const r of counts.rows) c[r.cls] = r.n;
    return computeSyncPlan({
      counts: c,
      dailyLimit: this.cfg.BRICKLINK_DAILY_REQUEST_LIMIT,
      reserveRatio: this.cfg.BRICKLINK_BUDGET_RESERVE_RATIO,
      usedLast24h: await this.requestsLast24h(),
      minIntervalMinutes: this.cfg.SYNC_MIN_INTERVAL_MINUTES,
      maxIntervalHours: this.cfg.SYNC_MAX_INTERVAL_HOURS,
      minSpacingMs: this.cfg.BRICKLINK_MIN_REQUEST_SPACING_MS,
      avgResponseMs: this.avgResponseMs(),
    });
  }

  // -------------------------------------------------------------------------
  // Sync cycle
  // -------------------------------------------------------------------------

  async runCycle(trigger = "schedule", maxRequests = 200): Promise<CycleResult> {
    if (!this.client.configured) {
      await this.setStatus({ connection_status: "not_configured", last_error: "BrickLink API credentials are not configured" });
      return { runId: null, status: "skipped", requestsUsed: 0, updated: 0, failed: 0, plan: null, note: "not_configured" };
    }
    const status = await this.pool.query<{ paused_until: Date | null }>("select paused_until from public.worker_status where id = 1");
    const pausedUntil = status.rows[0]?.paused_until;
    if (pausedUntil && pausedUntil.getTime() > Date.now()) {
      return { runId: null, status: "skipped", requestsUsed: 0, updated: 0, failed: 0, plan: null, note: "paused" };
    }

    await this.ensureTargets();
    const plan = await this.plan();
    const budget = Math.min(maxRequests, plan.remainingBudget);
    if (budget <= 0) {
      await this.setStatus({ connection_status: "rate_limited", last_error: "Daily request budget reached; waiting for it to free up" });
      return { runId: null, status: "skipped", requestsUsed: 0, updated: 0, failed: 0, plan, note: "budget" };
    }

    const due = await this.pool.query<DueTarget>(
      `select t.lego_set_id, t.condition, t.guide_type, t.consecutive_failures,
              s.bricklink_item_type as item_type, s.bricklink_item_number as item_number,
              exists (select 1 from public.holdings h where h.lego_set_id = t.lego_set_id) as held
         from public.sync_targets t join public.lego_sets s on s.id = t.lego_set_id
        where t.next_due_at <= now() and s.tracked
        order by held desc, (t.guide_type = 'sold') desc, t.next_due_at asc
        limit $1`,
      [budget],
    );
    if (due.rows.length === 0) {
      await this.setStatus({ heartbeat_at: new Date() });
      return { runId: null, status: "skipped", requestsUsed: 0, updated: 0, failed: 0, plan, note: "nothing_due" };
    }

    const run = await this.pool.query<{ id: number }>(
      "insert into public.sync_runs (trigger) values ($1) returning id",
      [trigger],
    );
    this.runId = run.rows[0]!.id;
    this.requestsThisRun = 0;
    let updated = 0;
    let failed = 0;
    const errors: { target: string; kind: string; message: string }[] = [];
    let fatal: BrickLinkError | null = null;

    for (const t of due.rows) {
      const cls = `${t.held ? "held" : "other"}_${t.guide_type}` as TargetClass;
      const label = `${t.item_type} ${t.item_number} ${t.condition} ${t.guide_type}`;
      const params = { guide_type: t.guide_type, new_or_used: t.condition, currency_code: "CAD", vat: "N" };
      try {
        const guide = await this.client.getPriceGuide({
          type: t.item_type,
          no: t.item_number,
          condition: t.condition,
          guideType: t.guide_type,
          currencyCode: "CAD",
        });
        if (guide.new_or_used !== t.condition) {
          throw new BrickLinkError("bad_response", `Requested condition ${t.condition} but BrickLink returned ${guide.new_or_used}`);
        }
        await withSystem(async (db) => {
          await insertObservation(db, { legoSetId: t.lego_set_id, guide, guideType: t.guide_type, requestParams: params, syncRunId: this.runId });
          await db.query(
            `update public.sync_targets set last_attempt_at = now(), last_success_at = now(), consecutive_failures = 0,
               last_error = null, next_due_at = now() + make_interval(secs => $4)
              where lego_set_id = $1 and condition = $2 and guide_type = $3`,
            [t.lego_set_id, t.condition, t.guide_type, plan.intervals[cls]],
          );
        }, this.pool);
        updated++;
      } catch (err) {
        const e = err instanceof BrickLinkError ? err : new BrickLinkError("bad_response", (err as Error).message);
        failed++;
        errors.push({ target: label, kind: e.kind, message: e.message.slice(0, 300) });
        const failures = t.consecutive_failures + 1;
        // Fatal conditions stop the cycle without penalizing this target.
        const isFatal = e.kind === "unauthorized" || e.kind === "rate_limited" || e.kind === "quota_exhausted" || e.kind === "not_configured";
        await this.pool.query(
          `update public.sync_targets set last_attempt_at = now(), consecutive_failures = $4, last_error = $5,
             next_due_at = now() + make_interval(secs => $6)
            where lego_set_id = $1 and condition = $2 and guide_type = $3`,
          [t.lego_set_id, t.condition, t.guide_type, isFatal ? t.consecutive_failures : failures, e.message.slice(0, 500), isFatal ? 0 : backoffSeconds(failures, e.kind)],
        );
        this.log.warn("BrickLink sync target failed", { target: label, kind: e.kind, http: e.httpStatus, code: e.bricklinkCode });
        if (isFatal) {
          fatal = e;
          break;
        }
      }
    }

    // Recompute portfolio valuations from the freshly stored observations.
    let snapshots = 0;
    try {
      snapshots = await withSystem((db) => writePortfolioSnapshots(db, { mode: this.cfg.APP_MODE, engine: this.engineOptions }), this.pool);
    } catch (err) {
      this.log.error("Portfolio snapshot failed", { error: (err as Error).message });
    }

    const statusText = fatal || (failed > 0 && updated === 0) ? "failed" : failed > 0 ? "partial" : "success";
    await this.pool.query(
      `update public.sync_runs set completed_at = now(), status = $2, requests_used = $3, sets_updated = $4,
         sets_failed = $5, errors = $6, note = $7 where id = $1`,
      [this.runId, statusText, this.requestsThisRun, updated, failed, JSON.stringify(errors.slice(0, 50)), `snapshots=${snapshots}`],
    );

    if (fatal) {
      const pauseSeconds = fatal.kind === "unauthorized" ? 1800 : fatal.kind === "rate_limited" || fatal.kind === "quota_exhausted" ? 3600 : 600;
      await this.setStatus({
        connection_status: fatal.kind === "unauthorized" ? "unauthorized" : fatal.kind === "not_configured" ? "not_configured" : "rate_limited",
        last_error: fatal.message.slice(0, 500),
        paused_until: new Date(Date.now() + pauseSeconds * 1000),
      });
    } else if (updated > 0) {
      await this.setStatus({ connection_status: failed > 0 ? "degraded" : "connected", last_success_at: new Date(), last_error: failed > 0 ? errors[0]?.message ?? null : null, paused_until: null });
    } else {
      const allNetwork = errors.every((e) => e.kind === "network" || e.kind === "unavailable");
      await this.setStatus({ connection_status: allNetwork ? "unavailable" : "degraded", last_error: errors[0]?.message ?? null });
    }

    const result: CycleResult = { runId: this.runId, status: statusText, requestsUsed: this.requestsThisRun, updated, failed, plan };
    this.log.info("Sync cycle finished", { runId: this.runId, status: statusText, requests: this.requestsThisRun, updated, failed, snapshots });
    this.runId = null;
    return result;
  }

  async nextDueAt(): Promise<Date | null> {
    const r = await this.pool.query<{ t: Date | null }>("select min(next_due_at) as t from public.sync_targets");
    return r.rows[0]?.t ?? null;
  }

  async setStatus(fields: Partial<Record<"heartbeat_at" | "next_sync_at" | "last_success_at" | "paused_until", Date | null> & Record<"connection_status" | "last_error", string | null> & { interval_seconds: number; details: Record<string, unknown> }>): Promise<void> {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length === 0) return;
    const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = keys.map((k) => (k === "details" ? JSON.stringify(fields[k]) : fields[k]));
    await this.pool.query(`update public.worker_status set ${sets} where id = 1`, values);
  }
}

export type { Db };
