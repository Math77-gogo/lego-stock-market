import "server-only";
import { getConfig } from "@/lib/config";
import type { ItemType } from "../bricklink/types";
import type { LegoSet } from "./service";

export type LookupResult =
  | { ok: true; set: LegoSet }
  | {
      ok: false;
      reason:
        | "not_found"
        | "worker_unavailable"
        | "bricklink_error"
        | "not_configured"
        | "secret_mismatch";
      detail?: string;
    };

/**
 * Catalog lookups are executed by the sync worker, the only process allowed to call BrickLink
 * (single registered IP, single quota counter).
 */
export async function lookupViaWorker(type: ItemType, no: string): Promise<LookupResult> {
  const cfg = getConfig();
  if (!cfg.WORKER_INTERNAL_URL || !cfg.WORKER_API_SECRET)
    return { ok: false, reason: "not_configured" };
  try {
    const res = await fetch(new URL("/internal/catalog/lookup", cfg.WORKER_INTERNAL_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.WORKER_API_SECRET}`,
      },
      body: JSON.stringify({ type, no }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (res.status === 401) return { ok: false, reason: "secret_mismatch" };
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, reason: "bricklink_error", detail: body.error ?? `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { set: LegoSet };
    return { ok: true, set: body.set };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "Worker lookup failed",
        error: (err as Error).message,
      }),
    );
    return { ok: false, reason: "worker_unavailable" };
  }
}

export async function requestSyncViaWorker(): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.WORKER_INTERNAL_URL || !cfg.WORKER_API_SECRET) return false;
  try {
    const res = await fetch(new URL("/internal/sync", cfg.WORKER_INTERNAL_URL), {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.WORKER_API_SECRET}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
