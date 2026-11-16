import { z } from "zod";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  APP_MODE: z.enum(["production", "test"]).default("production"),
  DATABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  BRICKLINK_API_BASE_URL: z.string().url().default("https://api.bricklink.com/api/store/v1"),
  BRICKLINK_CONSUMER_KEY: optionalSecret,
  BRICKLINK_CONSUMER_SECRET: optionalSecret,
  BRICKLINK_TOKEN_VALUE: optionalSecret,
  BRICKLINK_TOKEN_SECRET: optionalSecret,
  BRICKLINK_DAILY_REQUEST_LIMIT: z.coerce.number().int().positive().default(5000),
  BRICKLINK_BUDGET_RESERVE_RATIO: z.coerce.number().min(0).max(0.9).default(0.15),
  BRICKLINK_MIN_REQUEST_SPACING_MS: z.coerce.number().int().min(0).default(1500),
  BRICKLINK_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SYNC_MIN_INTERVAL_MINUTES: z.coerce.number().positive().default(30),
  SYNC_MAX_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  SYNC_STOCK_GUIDE_ENABLED: bool.default(true),
  SYNC_STALE_AFTER_HOURS: z.coerce.number().positive().default(36),
  SYNC_TICK_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_PORT: z.coerce.number().int().positive().default(8080),
  WORKER_INTERNAL_URL: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(/\/+$/, "") || undefined : v),
    z.string().url().optional(),
  ),
  // Trimmed: copy-pasting from a terminal often adds invisible spaces or line breaks.
  WORKER_API_SECRET: z.preprocess(
    // A too-short value (e.g. a fingerprint pasted by mistake) disables lookups instead of
    // crashing every page; the lookup form then explains the worker isn't configured.
    (v) => {
      if (typeof v !== "string") return v;
      const s = v.replace(/\s+/g, "");
      return s.length >= 32 ? s : undefined;
    },
    z.string().optional(),
  ),
  LOCAL_DEV_AUTH_USER_ID: z.string().uuid().optional(),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env && cached) return cached;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (parsed.data.LOCAL_DEV_AUTH_USER_ID && env.NODE_ENV === "production") {
    throw new Error("LOCAL_DEV_AUTH_USER_ID must never be set in production");
  }
  if (env === process.env) cached = parsed.data;
  return parsed.data;
}

export function bricklinkCredentials(cfg: AppConfig) {
  const {
    BRICKLINK_CONSUMER_KEY,
    BRICKLINK_CONSUMER_SECRET,
    BRICKLINK_TOKEN_VALUE,
    BRICKLINK_TOKEN_SECRET,
  } = cfg;
  if (
    !BRICKLINK_CONSUMER_KEY ||
    !BRICKLINK_CONSUMER_SECRET ||
    !BRICKLINK_TOKEN_VALUE ||
    !BRICKLINK_TOKEN_SECRET
  ) {
    return null;
  }
  return {
    consumerKey: BRICKLINK_CONSUMER_KEY,
    consumerSecret: BRICKLINK_CONSUMER_SECRET,
    tokenValue: BRICKLINK_TOKEN_VALUE,
    tokenSecret: BRICKLINK_TOKEN_SECRET,
  };
}
