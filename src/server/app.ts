import "server-only";
import { getConfig } from "@/lib/config";
import { withUser, type Db } from "./db/context";
import { requireUser, type SessionUser } from "./auth/session";
import type { EngineOptions } from "./pricing/engine";

export interface AppContext {
  user: SessionUser;
  mode: "production" | "test";
  engine: EngineOptions;
  /** Runs queries as the signed-in user (RLS enforced). */
  db: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
}

export async function appContext(): Promise<AppContext> {
  const user = await requireUser();
  const cfg = getConfig();
  return {
    user,
    mode: cfg.APP_MODE,
    engine: {
      currency: "CAD",
      staleAfterHours: cfg.SYNC_STALE_AFTER_HOURS,
      minUnitsForConfidence: 3,
    },
    db: (fn) => withUser(user.id, fn),
  };
}
