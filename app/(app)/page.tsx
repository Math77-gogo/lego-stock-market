import Link from "next/link";
import { appContext } from "@/server/app";
import {
  getDefaultPortfolio,
  loadPositions,
  marketSeriesFor,
  totalsFor,
  type PositionView,
} from "@/server/portfolio/service";
import { syncStatus } from "@/server/market/queries";
import { PortfolioPerformance } from "@/components/PortfolioPerformance";
import { HoldingRow } from "@/components/HoldingRow";
import { LocalTime } from "@/components/LocalTime";
import { Delta, EmptyState, Notice, Section, SetImage, Stat } from "@/components/ui";
import { count, money, pct, signedMoney, toneClass } from "@/lib/format";
import { getConfig } from "@/lib/config";
import { t } from "@/lib/i18n";

export const metadata = { title: "Home" };

function Performer({
  label,
  p,
  value,
  valueClass,
}: {
  label: string;
  p: PositionView | undefined;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="card min-w-0 p-4">
      <div className="label">{label}</div>
      {p ? (
        <Link href={`/portfolio/${p.holdingId}`} className="mt-3 flex items-center gap-3">
          <SetImage src={p.set.thumbnailUrl ?? p.set.imageUrl} alt="" size={40} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{p.set.name}</div>
            <div className={`text-sm font-bold tabular-nums ${valueClass ?? ""}`}>{value}</div>
          </div>
        </Link>
      ) : (
        <p className="mt-3 text-sm text-muted">Insufficient BrickLink data</p>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const ctx = await appContext();
  const { positions, series, status } = await ctx.db(async (db) => {
    const portfolio = await getDefaultPortfolio(db, ctx.user.id);
    const positions = await loadPositions(db, {
      portfolioIds: [portfolio.id],
      mode: ctx.mode,
      engine: ctx.engine,
    });
    return {
      positions,
      series: await marketSeriesFor(db, positions, ctx.mode),
      status: await syncStatus(db, getConfig().BRICKLINK_DAILY_REQUEST_LIMIT),
    };
  });
  const open = positions.filter((p) => p.quantity > 0);
  const totals = totalsFor(positions);

  if (open.length === 0 && positions.length === 0) {
    return (
      <div className="max-w-3xl">
        <div className="label">{t("dashboard.total")}</div>
        <div className="mt-1 text-hero">{money(0)}</div>
        <div className="mt-10">
          <EmptyState
            title="Your portfolio is empty"
            body="Find a set in the BrickLink catalog, record what you paid, and its value will follow BrickLink's completed sales in CAD."
            action={
              <Link href="/market" className="btn-primary">
                Add your first set
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const priced = open.filter((p) => p.unrealizedPct !== null);
  const best = [...priced].sort((a, b) => b.unrealizedPct! - a.unrealizedPct!)[0];
  const worst = [...priced].sort((a, b) => a.unrealizedPct! - b.unrealizedPct!)[0];
  const largest = [...open]
    .filter((p) => p.marketValue !== null)
    .sort((a, b) => b.marketValue! - a.marketValue!)[0];
  const active = [...open]
    .filter((p) => p.reference.unitsSold !== null && p.reference.price !== null)
    .sort((a, b) => b.reference.unitsSold! - a.reference.unitsSold!)[0];
  const stale = open.filter((p) => p.reference.isStale).length;

  return (
    <div className="max-w-3xl">
      <PortfolioPerformance totals={totals} series={series} />

      <div className="mt-4 space-y-2">
        {!totals.complete && (
          <Notice>
            {totals.unpricedPositions} position{totals.unpricedPositions === 1 ? " has" : "s have"}{" "}
            insufficient BrickLink data and {totals.unpricedPositions === 1 ? "is" : "are"} not
            included in the total value.
          </Notice>
        )}
        {stale > 0 && (
          <Notice>
            {stale} price{stale === 1 ? " is" : "s are"} older than {ctx.engine.staleAfterHours} h.
            The last valid BrickLink value is shown with its age.
          </Notice>
        )}
        <p className="flex flex-wrap gap-x-1.5 px-1 text-xs text-muted">
          <span>BrickLink data last synchronized</span>
          <span className="font-semibold text-ink">
            <LocalTime iso={status.lastSuccessAt} mode="relative" />
          </span>
          <span>·</span>
          <Link href="/settings" className="underline-offset-2 hover:underline">
            Sync status
          </Link>
        </p>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 px-1 sm:grid-cols-3">
        <Stat label="Total cost" value={money(totals.costBasis)} />
        <Stat
          label="Unrealized P/L"
          value={signedMoney(totals.unrealizedPl)}
          valueClass={toneClass(totals.unrealizedPl)}
          sub={totals.complete ? undefined : "Priced positions only"}
        />
        <Stat
          label="Realized P/L"
          value={signedMoney(totals.realizedPl)}
          valueClass={toneClass(totals.realizedPl)}
        />
        <Stat label="Total return" value={<Delta pctValue={totals.totalReturnPct} />} />
        <Stat label="Different sets" value={count(totals.distinctSets)} />
        <Stat label="Units" value={count(totals.units)} />
      </div>

      <Section title={t("dashboard.topPerformers")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Performer
            label="Best performer"
            p={best}
            value={pct(best?.unrealizedPct)}
            valueClass={toneClass(best?.unrealizedPct)}
          />
          <Performer
            label="Worst performer"
            p={worst}
            value={pct(worst?.unrealizedPct)}
            valueClass={toneClass(worst?.unrealizedPct)}
          />
          <Performer label="Largest position" p={largest} value={money(largest?.marketValue)} />
          <Performer
            label="Most actively traded"
            p={active}
            value={active ? `${count(active.reference.unitsSold)} sold on BrickLink (6 mo)` : "—"}
          />
        </div>
      </Section>

      <Section
        title={t("dashboard.holdings")}
        action={
          <Link href="/market" className="chip">
            + Add set
          </Link>
        }
      >
        <ul className="card divide-y divide-line px-1 py-1 sm:px-2">
          {open.map((p) => (
            <HoldingRow key={p.holdingId} p={p} />
          ))}
        </ul>
        {open.length < positions.length && (
          <p className="mt-3 px-1 text-xs text-muted">
            {positions.length - open.length} fully sold position(s) are listed in{" "}
            <Link href="/portfolio" className="underline">
              Portfolio
            </Link>
            .
          </p>
        )}
      </Section>
    </div>
  );
}
