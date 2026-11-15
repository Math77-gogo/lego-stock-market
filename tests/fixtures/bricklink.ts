import type { Transport, TransportRequest } from "@/server/bricklink/client";

/**
 * Mock BrickLink transport for automated tests ONLY. Responses follow the documented
 * BrickLink API v1 envelope. The client refuses this transport in production mode.
 */
export interface MockState {
  items: Record<string, { name: string; category_id: number; year_released: number }>;
  prices: Record<string, { qty_avg: string; avg: string; min: string; max: string; units: number; total: number; currency?: string }>;
  failNext: { status?: number; metaCode?: number; body?: string; throws?: boolean }[];
  calls: TransportRequest[];
}

export function createMockState(): MockState {
  return {
    items: {
      "SET/75192-1": { name: "Millennium Falcon - UCS (2nd edition)", category_id: 65, year_released: 2017 },
      "SET/10497-1": { name: "Galaxy Explorer", category_id: 5, year_released: 2022 },
    },
    prices: {
      "75192-1:N:sold": { qty_avg: "1123.4567", avg: "1130.0000", min: "899.0000", max: "1499.9900", units: 42, total: 44 },
      "75192-1:U:sold": { qty_avg: "850.1000", avg: "861.2500", min: "600.0000", max: "1100.0000", units: 17, total: 17 },
      "75192-1:N:stock": { qty_avg: "1299.0000", avg: "1320.0000", min: "1099.0000", max: "1999.0000", units: 30, total: 35 },
      "75192-1:U:stock": { qty_avg: "999.0000", avg: "1010.0000", min: "800.0000", max: "1300.0000", units: 9, total: 9 },
      "10497-1:N:sold": { qty_avg: "140.0000", avg: "142.0000", min: "120.0000", max: "170.0000", units: 80, total: 85 },
      "10497-1:U:sold": { qty_avg: "0", avg: "0", min: "0", max: "0", units: 0, total: 0 },
    },
    failNext: [],
    calls: [],
  };
}

const ok = (data: unknown) => ({ status: 200, body: JSON.stringify({ meta: { code: 200, message: "OK", description: "OK" }, data }) });
const meta = (code: number, message: string) => ({ status: code, body: JSON.stringify({ meta: { code, message, description: message } }) });

export function mockTransport(state: MockState): Transport {
  const t: Transport = async (req) => {
    state.calls.push(req);
    const fail = state.failNext.shift();
    if (fail) {
      if (fail.throws) throw new Error("socket hang up");
      if (fail.body !== undefined) return { status: fail.status ?? 200, body: fail.body };
      if (fail.metaCode) return meta(fail.metaCode, "FAILED");
      return { status: fail.status ?? 500, body: "Internal Server Error" };
    }
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/store\/v1/, "");
    if (path === "/categories") {
      return ok([
        { category_id: 65, category_name: "Star Wars", parent_id: 0 },
        { category_id: 5, category_name: "Space", parent_id: 0 },
      ]);
    }
    const priceMatch = path.match(/^\/items\/(\w+)\/([^/]+)\/price$/);
    if (priceMatch) {
      const [, type, no] = priceMatch;
      const cond = url.searchParams.get("new_or_used") ?? "N";
      const guide = url.searchParams.get("guide_type") ?? "stock";
      const p = state.prices[`${decodeURIComponent(no!)}:${cond}:${guide}`];
      if (!p) return meta(404, "RESOURCE_NOT_FOUND");
      return ok({
        item: { no: decodeURIComponent(no!), type },
        new_or_used: cond,
        currency_code: p.currency ?? url.searchParams.get("currency_code") ?? "USD",
        min_price: p.min,
        max_price: p.max,
        avg_price: p.avg,
        qty_avg_price: p.qty_avg,
        unit_quantity: p.units,
        total_quantity: p.total,
        price_detail: p.units > 0 ? [{ quantity: 1, unit_price: p.qty_avg, date_ordered: "2026-11-01T10:00:00.000Z", buyer_country_code: "CA", seller_country_code: "US" }] : [],
      });
    }
    const itemMatch = path.match(/^\/items\/(\w+)\/([^/]+)$/);
    if (itemMatch) {
      const [, type, no] = itemMatch;
      const item = state.items[`${type}/${decodeURIComponent(no!)}`];
      if (!item) return meta(404, "RESOURCE_NOT_FOUND");
      return ok({
        no: decodeURIComponent(no!),
        type,
        name: item.name,
        category_id: item.category_id,
        image_url: `//img.bricklink.com/ItemImage/SN/0/${no}.png`,
        thumbnail_url: `//img.bricklink.com/ItemImage/ST/0/${no}.t1.png`,
        year_released: item.year_released,
        is_obsolete: false,
      });
    }
    return meta(404, "RESOURCE_NOT_FOUND");
  };
  t.isMock = true;
  return t;
}

export const TEST_CREDENTIALS = {
  BRICKLINK_CONSUMER_KEY: "test-consumer-key",
  BRICKLINK_CONSUMER_SECRET: "test-consumer-secret",
  BRICKLINK_TOKEN_VALUE: "test-token-value",
  BRICKLINK_TOKEN_SECRET: "test-token-secret",
};
