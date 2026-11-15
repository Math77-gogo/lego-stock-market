import type { Db } from "../db/context";
import type { PriceGuide, Condition, GuideType } from "../bricklink/types";
import type { PriceObservation } from "../pricing/engine";

/**
 * Which observation sources may be shown. Production only ever reads official BrickLink API rows.
 * Test mode may also read fixture rows (and the UI shows a TEST MODE banner).
 */
export function allowedSources(mode: "production" | "test"): string[] {
  return mode === "production" ? ["bricklink_api_v1"] : ["bricklink_api_v1", "test_fixture"];
}

export interface StoredObservation extends PriceObservation {
  id: number;
  legoSetId: string;
  source: string;
}

interface ObservationRow {
  id: number;
  lego_set_id: string;
  condition: Condition;
  guide_type: GuideType;
  avg_price: string | null;
  qty_avg_price: string | null;
  min_price: string | null;
  max_price: string | null;
  unit_quantity: number | null;
  total_quantity: number | null;
  currency_code: string;
  observed_at: Date;
  source: string;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export function mapObservation(r: ObservationRow): StoredObservation {
  return {
    id: r.id,
    legoSetId: r.lego_set_id,
    condition: r.condition,
    guideType: r.guide_type,
    avgPrice: num(r.avg_price),
    qtyAvgPrice: num(r.qty_avg_price),
    minPrice: num(r.min_price),
    maxPrice: num(r.max_price),
    unitQuantity: r.unit_quantity,
    totalQuantity: r.total_quantity,
    currencyCode: r.currency_code,
    observedAt: r.observed_at,
    source: r.source,
  };
}

const COLS = `id, lego_set_id, condition, guide_type, avg_price, qty_avg_price, min_price, max_price,
  unit_quantity, total_quantity, currency_code, observed_at, source`;

/** Stores one BrickLink Price Guide API response as an immutable observation. */
export async function insertObservation(
  db: Db,
  input: {
    legoSetId: string;
    guide: PriceGuide;
    guideType: GuideType;
    requestParams: Record<string, string>;
    syncRunId: number | null;
    source?: "bricklink_api_v1" | "test_fixture";
    observedAt?: Date;
  },
): Promise<number> {
  const g = input.guide;
  const res = await db.query<{ id: number }>(
    `insert into public.bricklink_price_observations
      (lego_set_id, condition, guide_type, avg_price, qty_avg_price, min_price, max_price, unit_quantity,
       total_quantity, currency_code, observed_at, source, request_params, raw_response, sync_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, now()),$12,$13,$14,$15) returning id`,
    [
      input.legoSetId,
      g.new_or_used,
      input.guideType,
      g.avg_price ?? null,
      g.qty_avg_price ?? null,
      g.min_price ?? null,
      g.max_price ?? null,
      g.unit_quantity ?? null,
      g.total_quantity ?? null,
      g.currency_code,
      input.observedAt ?? null,
      input.source ?? "bricklink_api_v1",
      JSON.stringify(input.requestParams),
      JSON.stringify(g),
      input.syncRunId,
    ],
  );
  return res.rows[0]!.id;
}

/** Latest observation per (set, condition) for one guide type. Key: `${setId}:${condition}`. */
export async function latestObservations(
  db: Db,
  setIds: string[],
  guideType: GuideType,
  mode: "production" | "test",
): Promise<Map<string, StoredObservation>> {
  const out = new Map<string, StoredObservation>();
  if (setIds.length === 0) return out;
  const res = await db.query<ObservationRow>(
    `select distinct on (lego_set_id, condition) ${COLS}
       from public.bricklink_price_observations
      where lego_set_id = any($1::uuid[]) and guide_type = $2 and source = any($3::text[])
      order by lego_set_id, condition, observed_at desc`,
    [setIds, guideType, allowedSources(mode)],
  );
  for (const r of res.rows) out.set(`${r.lego_set_id}:${r.condition}`, mapObservation(r));
  return out;
}

export async function observationSeries(
  db: Db,
  setIds: string[],
  guideType: GuideType,
  since: Date | null,
  mode: "production" | "test",
): Promise<Map<string, StoredObservation[]>> {
  const out = new Map<string, StoredObservation[]>();
  if (setIds.length === 0) return out;
  const res = await db.query<ObservationRow>(
    `select ${COLS} from public.bricklink_price_observations
      where lego_set_id = any($1::uuid[]) and guide_type = $2 and source = any($3::text[])
        and ($4::timestamptz is null or observed_at >= $4)
      order by observed_at asc`,
    [setIds, guideType, allowedSources(mode), since],
  );
  for (const r of res.rows) {
    const key = `${r.lego_set_id}:${r.condition}`;
    const list = out.get(key) ?? [];
    list.push(mapObservation(r));
    out.set(key, list);
  }
  return out;
}

/** Individual sales from the most recent sold Price Guide response (BrickLink's price_detail). */
export async function recentSales(
  db: Db,
  setId: string,
  condition: Condition,
  mode: "production" | "test",
  limit = 10,
): Promise<{ quantity: number; unitPrice: number; dateOrdered: string; currency: string }[]> {
  const res = await db.query<{ raw_response: PriceGuide | null; currency_code: string }>(
    `select raw_response, currency_code from public.bricklink_price_observations
      where lego_set_id = $1 and condition = $2 and guide_type = 'sold' and source = any($3::text[])
      order by observed_at desc limit 1`,
    [setId, condition, allowedSources(mode)],
  );
  const row = res.rows[0];
  if (!row?.raw_response?.price_detail) return [];
  return row.raw_response.price_detail
    .map((d) => ({
      quantity: Number(d.quantity ?? d.qunatity ?? 0),
      unitPrice: Number(d.unit_price ?? NaN),
      dateOrdered: String(d.date_ordered ?? ""),
      currency: row.currency_code,
    }))
    .filter((d) => d.quantity > 0 && Number.isFinite(d.unitPrice) && d.dateOrdered)
    .sort((a, b) => (a.dateOrdered < b.dateOrdered ? 1 : -1))
    .slice(0, limit);
}
