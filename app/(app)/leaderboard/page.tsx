import Link from "next/link";
import { appContext } from "@/server/app";
import { leaderboard, PERIODS, type PeriodKey } from "@/server/market/queries";
import { LocalTime } from "@/components/LocalTime";
import { ConditionBadge, EmptyState, PageHeader, SetImage } from "@/components/ui";
import { count, money, pct, toneClass } from "@/lib/format";

export const metadata = { title: "Rankings" };

const VIEWS = [
  { key: "gainers", label: "Top gainers" },
  { key: "losers", label: "Biggest declines" },
  { key: "volume", label: "Sales volume" },
] as const;
const PERIOD_LABEL: Record<PeriodKey, string> = {
  "1D": "24 h",
  "1W": "7 d",
  "1M": "30 d",
  "3M": "90 d",
  "6M": "6 mo",
  "1Y": "1 yr",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "gainers";
  const period = (Object.keys(PERIODS) as PeriodKey[]).find((p) => p === sp.period) ?? "1W";
  const ctx = await appContext();
  const { entries, excluded } = await ctx.db((db) => leaderboard(db, ctx.mode, ctx.engine, period));

  const list =
    view === "volume"
      ? entries
          .filter((e) => (e.unitsSold ?? 0) > 0)
          .sort((a, b) => (b.unitsSold ?? 0) - (a.unitsSold ?? 0))
      : entries
          .filter((e) => e.change)
          .sort((a, b) =>
            view === "gainers" ? b.change!.pct - a.change!.pct : a.change!.pct - b.change!.pct,
          );
  const href = (patch: { view?: string; period?: string }) =>
    `/leaderboard?view=${patch.view ?? view}&period=${patch.period ?? period}`;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Rankings"
        subtitle="Only sets with enough BrickLink observations collected by this app are ranked."
      />
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Ranking" className="inline-flex rounded-full bg-raised p-1">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              role="tab"
              aria-selected={view === v.key}
              href={href({ view: v.key })}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${view === v.key ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        {view !== "volume" && (
          <div role="tablist" aria-label="Period" className="flex gap-1">
            {(Object.keys(PERIODS) as PeriodKey[]).map((p) => (
              <Link
                key={p}
                role="tab"
                aria-selected={period === p}
                href={href({ period: p })}
                className="chip"
              >
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Not enough historical data"
            body={`No tracked set has BrickLink observations spanning ${PERIOD_LABEL[period]} yet. Rankings fill in as the sync worker keeps collecting.`}
          />
        </div>
      ) : (
        <ol className="card mt-6 divide-y divide-line px-2 sm:px-4">
          {list.slice(0, 50).map((e, i) => (
            <li key={`${e.set.id}:${e.condition}`}>
              <Link
                href={`/market/${e.set.itemType}/${encodeURIComponent(e.set.itemNumber)}?condition=${e.condition}`}
                className="flex items-center gap-3 py-3"
              >
                <span className="w-6 text-center text-sm font-bold text-muted">{i + 1}</span>
                <SetImage src={e.set.thumbnailUrl ?? e.set.imageUrl} alt="" size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{e.set.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    {e.set.itemNumber} <ConditionBadge condition={e.condition} /> {e.observations}{" "}
                    obs · <LocalTime iso={e.observedAt} mode="relative" />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{money(e.price)}</div>
                  {view === "volume" ? (
                    <div className="text-xs font-semibold text-muted">
                      {count(e.unitsSold)} sold
                    </div>
                  ) : (
                    <div className={`text-xs font-bold tabular-nums ${toneClass(e.change?.pct)}`}>
                      {pct(e.change?.pct)}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {excluded > 0 && (
        <p className="mt-3 px-1 text-xs text-muted">
          {excluded} set/condition pairs excluded for insufficient or stale data.
        </p>
      )}
    </div>
  );
}
