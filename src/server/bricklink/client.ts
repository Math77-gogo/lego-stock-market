import { z } from "zod";
import { signRequest, type OAuthCredentials } from "./oauth1";
import { BrickLinkError } from "./errors";
import {
  catalogItemSchema,
  categorySchema,
  metaSchema,
  priceGuideSchema,
  type CatalogItem,
  type Category,
  type Condition,
  type GuideType,
  type ItemType,
  type PriceGuide,
} from "./types";

export interface TransportRequest {
  method: "GET";
  url: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}
export interface TransportResponse {
  status: number;
  body: string;
}
export type Transport = ((req: TransportRequest) => Promise<TransportResponse>) & {
  isMock?: boolean;
};

export interface RequestLogEntry {
  method: string;
  endpoint: string;
  httpStatus?: number;
  bricklinkCode?: number;
  durationMs: number;
  ok: boolean;
}

export interface BrickLinkClientOptions {
  baseUrl: string;
  credentials: OAuthCredentials | null;
  mode: "production" | "test";
  transport?: Transport;
  timeoutMs?: number;
  minSpacingMs?: number;
  /** Called before every HTTP request. Throw (e.g. quota exhausted) to stop it. */
  beforeRequest?: () => Promise<void>;
  /** Called after every HTTP request, successful or not (quota accounting, logs). */
  onRequest?: (entry: RequestLogEntry) => Promise<void> | void;
}

export const fetchTransport: Transport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    signal: req.signal,
  });
  return { status: res.status, body: await res.text() };
};

export interface PriceGuideQuery {
  type: ItemType;
  no: string;
  condition: Condition;
  guideType: GuideType;
  currencyCode?: string; // default CAD
}

/**
 * The one and only gateway to market data. Talks to the official BrickLink Store API v1
 * (https://www.bricklink.com/v3/api.page) with OAuth 1.0a.
 */
export class BrickLinkClient {
  private readonly transport: Transport;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: BrickLinkClientOptions) {
    if (opts.transport?.isMock && opts.mode === "production") {
      throw new Error("Mock BrickLink transport cannot be used in production mode");
    }
    this.transport = opts.transport ?? fetchTransport;
  }

  get configured(): boolean {
    return this.opts.credentials !== null;
  }

  getItem(type: ItemType, no: string): Promise<CatalogItem> {
    return this.request(`/items/${type}/${encodeURIComponent(no)}`, {}, catalogItemSchema);
  }

  getPriceGuide(q: PriceGuideQuery): Promise<PriceGuide> {
    const params = {
      guide_type: q.guideType,
      new_or_used: q.condition,
      currency_code: q.currencyCode ?? "CAD",
      vat: "N",
    };
    return this.request(
      `/items/${q.type}/${encodeURIComponent(q.no)}/price`,
      params,
      priceGuideSchema,
    );
  }

  getCategories(): Promise<Category[]> {
    return this.request("/categories", {}, z.array(categorySchema));
  }

  /** Requests are serialized and spaced to stay well inside BrickLink's limits. */
  private request<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const run = this.queue.then(() => this.send(path, params, schema));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const credentials = this.opts.credentials;
    if (!credentials)
      throw new BrickLinkError("not_configured", "BrickLink API credentials are not configured");
    await this.opts.beforeRequest?.();

    const spacing = this.opts.minSpacingMs ?? 0;
    const wait = this.lastRequestAt + spacing - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const url = new URL(this.opts.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const { header } = signRequest({ method: "GET", url: url.toString(), credentials });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    const started = Date.now();
    this.lastRequestAt = started;
    const log: RequestLogEntry = { method: "GET", endpoint: path, durationMs: 0, ok: false };

    try {
      let res: TransportResponse;
      try {
        res = await this.transport({
          method: "GET",
          url: url.toString(),
          headers: { Authorization: header, Accept: "application/json" },
          signal: controller.signal,
        });
      } catch (err) {
        throw new BrickLinkError("network", `BrickLink request failed: ${(err as Error).message}`);
      }
      log.httpStatus = res.status;

      if (res.status === 429)
        throw new BrickLinkError("rate_limited", "BrickLink rate limit reached", 429);
      if (res.status >= 500)
        throw new BrickLinkError(
          "unavailable",
          `BrickLink returned HTTP ${res.status}`,
          res.status,
        );

      let json: unknown;
      try {
        json = JSON.parse(res.body);
      } catch {
        throw new BrickLinkError(
          "bad_response",
          "BrickLink returned a non-JSON response",
          res.status,
        );
      }
      const envelope = z.object({ meta: metaSchema, data: z.unknown().optional() }).safeParse(json);
      if (!envelope.success)
        throw new BrickLinkError(
          "bad_response",
          "Unexpected BrickLink response envelope",
          res.status,
        );

      const { code, message, description } = envelope.data.meta;
      log.bricklinkCode = code;
      if (code !== 200) throw mapMetaError(code, `${message} ${description}`.trim(), res.status);

      const data = schema.safeParse(envelope.data.data);
      if (!data.success)
        throw new BrickLinkError(
          "bad_response",
          "BrickLink response did not match the documented schema",
          res.status,
          code,
        );
      log.ok = true;
      return data.data;
    } finally {
      clearTimeout(timer);
      log.durationMs = Date.now() - started;
      await this.opts.onRequest?.(log);
    }
  }
}

function mapMetaError(code: number, detail: string, httpStatus: number): BrickLinkError {
  const msg = `BrickLink error ${code}${detail ? `: ${detail}` : ""}`;
  switch (code) {
    case 401:
    case 403:
      return new BrickLinkError("unauthorized", msg, httpStatus, code);
    case 404:
      return new BrickLinkError("not_found", msg, httpStatus, code);
    case 429:
      return new BrickLinkError("rate_limited", msg, httpStatus, code);
    case 400:
    case 405:
    case 415:
    case 422:
      return new BrickLinkError("invalid_request", msg, httpStatus, code);
    default:
      return code >= 500
        ? new BrickLinkError("unavailable", msg, httpStatus, code)
        : new BrickLinkError("bad_response", msg, httpStatus, code);
  }
}
