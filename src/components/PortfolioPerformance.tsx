import { PriceChart } from "./PriceChart";
import { pct, signedMoney, toneClass } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PortfolioTotals, SeriesPoint } from "@/server/pricing/engine";

/**
 * Wealthsimple-style header: the big number and the chart move with the market only;
 * "Total return" below compares today's value with what was actually paid.
 */
export function PortfolioPerformance({
  totals,
  series,
}: {
  totals: PortfolioTotals;
  series: SeriesPoint[];
}) {
  return (
    <div className="card p-5 sm:p-7">
      <PriceChart
        label={t("dashboard.total")}
        headlineValue={totals.marketValue}
        headlineSuffix="CAD"
        points={series}
        defaultRange="1M"
        footnote="Market performance of the sets you own now, from BrickLink prices only. Adding or selling sets, and what you paid, never move this line. Your profit versus what you paid is the Total return below."
        emptyBody="Your market performance appears once BrickLink prices have been collected at least twice."
      />
      <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="label">{t("dashboard.today")}</dt>
          <dd
            className={
              totals.dayChange !== null
                ? `font-bold tabular-nums ${toneClass(totals.dayChange)}`
                : "text-muted"
            }
          >
            {totals.dayChange !== null
              ? `${signedMoney(totals.dayChange)} (${pct(totals.dayChangePct)})`
              : "Not enough history for 24 h yet"}
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="label">Total return</dt>
          <dd
            className={
              totals.totalReturnPct !== null
                ? `font-bold tabular-nums ${toneClass(totals.totalReturn)}`
                : "text-muted"
            }
          >
            {totals.totalReturnPct !== null
              ? `${signedMoney(totals.totalReturn)} (${pct(totals.totalReturnPct)})`
              : "Add what you paid to see it"}
          </dd>
          <span className="w-full text-xs text-muted">vs. what you paid, including sales</span>
        </div>
      </dl>
    </div>
  );
}
