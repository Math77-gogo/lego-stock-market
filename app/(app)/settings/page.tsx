import { appContext } from "@/server/app";
import { syncStatus } from "@/server/market/queries";
import { getConfig } from "@/lib/config";
import { signOutAction } from "@/app/actions";
import { SyncNowButton } from "@/components/forms";
import { LocalTime } from "@/components/LocalTime";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Notice, PageHeader, Section, Stat } from "@/components/ui";
import { count } from "@/lib/format";

export const metadata = { title: "Settings" };

const STATUS: Record<string, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "bg-gain" },
  degraded: { label: "Partially failing", tone: "bg-warn" },
  unavailable: { label: "BrickLink unavailable", tone: "bg-loss" },
  unauthorized: { label: "Credentials rejected", tone: "bg-loss" },
  rate_limited: { label: "Rate limited, paused", tone: "bg-warn" },
  not_configured: { label: "Credentials not configured", tone: "bg-loss" },
  worker_offline: { label: "Worker offline", tone: "bg-loss" },
  unknown: { label: "Waiting for first sync", tone: "bg-faint" },
};

export default async function SettingsPage() {
  const ctx = await appContext();
  const cfg = getConfig();
  const s = await ctx.db((db) => syncStatus(db, cfg.BRICKLINK_DAILY_REQUEST_LIMIT));
  const st = STATUS[s.connectionStatus] ?? STATUS.unknown!;
  const used = Math.min(100, (s.requests24h / s.dailyLimit) * 100);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />

      <Section title="BrickLink synchronization" className="mt-0">
        <div className="card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${st.tone}`} />
              <span className="font-bold">{st.label}</span>
            </div>
            <SyncNowButton />
          </div>
          {s.lastError && (
            <div className="mt-4">
              <Notice tone="error">{s.lastError}</Notice>
            </div>
          )}
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3">
            <Stat
              label="Last successful sync"
              value={
                <span className="text-base">
                  <LocalTime iso={s.lastSuccessAt} mode="relative" />
                </span>
              }
              sub={s.lastSuccessAt ? <LocalTime iso={s.lastSuccessAt} /> : undefined}
            />
            <Stat
              label="Next scheduled check"
              value={
                <span className="text-base">
                  {s.nextSyncAt ? <LocalTime iso={s.nextSyncAt} /> : "—"}
                </span>
              }
              sub={
                s.intervalSeconds
                  ? `Price refresh every ~${Math.round(s.intervalSeconds / 60)} min`
                  : undefined
              }
            />
            <Stat
              label="Worker heartbeat"
              value={
                <span className="text-base">
                  <LocalTime iso={s.heartbeatAt} mode="relative" />
                </span>
              }
            />
            <Stat label="Tracked sets" value={count(s.trackedSets)} />
            <Stat label="Up to date" value={count(s.targetsOk)} sub="set × condition × guide" />
            <Stat
              label="Failing"
              value={count(s.targetsFailing)}
              valueClass={s.targetsFailing ? "text-loss" : undefined}
            />
          </div>
          <div className="mt-6">
            <div className="flex justify-between text-xs font-semibold">
              <span>API requests, last 24 h</span>
              <span className="tabular-nums">
                {count(s.requests24h)} / {count(s.dailyLimit)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${used > 85 ? "bg-warn" : "bg-ink"}`}
                style={{ width: `${used}%` }}
              />
            </div>
          </div>
        </div>

        <h3 className="mb-2 mt-6 text-sm font-bold">Recent sync runs</h3>
        {s.recentRuns.length === 0 ? (
          <p className="text-sm text-muted">No sync has run yet.</p>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left">
                  <th className="label px-5 py-3 font-semibold">Started</th>
                  <th className="label px-3 py-3 font-semibold">Status</th>
                  <th className="label px-3 py-3 text-right font-semibold">Requests</th>
                  <th className="label px-3 py-3 text-right font-semibold">Updated</th>
                  <th className="label px-5 py-3 text-right font-semibold">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.recentRuns.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2.5">
                      <LocalTime iso={r.startedAt} />
                    </td>
                    <td className="px-3 py-2.5 capitalize">{r.status}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.requestsUsed}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.setsUpdated}</td>
                    <td
                      className={`px-5 py-2.5 text-right tabular-nums ${r.setsFailed ? "text-loss" : ""}`}
                    >
                      {r.setsFailed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Data source">
        <div className="card space-y-2 p-5 text-sm text-muted">
          <p>
            All market data comes from the official BrickLink API (Price Guide, Store API v1).
            Values are requested in CAD; if BrickLink returns another currency the value is shown as
            unavailable rather than converted.
          </p>
          <p>
            Portfolio valuation uses the quantity-weighted average sold price for each condition.
            Current listing prices are informational only.
          </p>
          <p>
            Mode:{" "}
            <span className="font-semibold text-ink">
              {ctx.mode === "production" ? "Production" : "Test"}
            </span>
          </p>
        </div>
      </Section>

      <Section title="Appearance">
        <ThemeToggle />
      </Section>

      <Section title="Account">
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="text-sm">
            Signed in as <span className="font-semibold">{ctx.user.email}</span>
          </div>
          <form action={signOutAction}>
            <button className="btn-secondary">Sign out</button>
          </form>
        </div>
      </Section>
    </div>
  );
}
