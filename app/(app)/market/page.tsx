import Link from "next/link";
import { appContext } from "@/server/app";
import { listThemes, searchCatalog } from "@/server/catalog/service";
import { marketRows } from "@/server/market/queries";
import { LookupForm } from "@/components/forms";
import { EmptyState, PageHeader, SetImage } from "@/components/ui";
import { count, money, pct, toneClass } from "@/lib/format";

export const metadata = { title: "Market" };

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; theme?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const theme = sp.theme || null;
  const cond = sp.c === "U" ? "U" : "N";
  const ctx = await appContext();
  const { rows, themes } = await ctx.db(async (db) => {
    const sets = await searchCatalog(db, q, { theme, limit: 60 });
    return { rows: await marketRows(db, sets, ctx.mode, ctx.engine), themes: await listThemes(db) };
  });
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { q: q || null, theme, c: cond === "U" ? "U" : null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/market?${s}` : "/market";
  };

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Market"
        subtitle="Every price is BrickLink's quantity-weighted average of completed sales over the last 6 months, in CAD."
        action={
          <Link href="/leaderboard" className="btn-secondary">
            Rankings
          </Link>
        }
      />

      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold">Find any item in the BrickLink catalog</div>
        <LookupForm />
        <p className="mt-3 text-xs text-muted">
          BrickLink&apos;s official API looks items up by exact catalog number. Sets found here are
          tracked and searchable below by name and theme.
        </p>
      </div>

      <form className="mt-6 flex flex-col gap-2 sm:flex-row" action="/market">
        <label htmlFor="market-q" className="sr-only">
          Search tracked sets
        </label>
        <input
          id="market-q"
          name="q"
          defaultValue={q}
          placeholder="Search tracked sets by number, name or theme"
          className="input"
        />
        <label htmlFor="market-theme" className="sr-only">
          Theme
        </label>
        <select id="market-theme" name="theme" defaultValue={theme ?? ""} className="input sm:w-52">
          <option value="">All themes</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {cond === "U" && <input type="hidden" name="c" value="U" />}
        <button className="btn-secondary shrink-0">Search</button>
      </form>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{count(rows.length)} sets</div>
        <div
          role="tablist"
          aria-label="Changes shown for"
          className="inline-flex rounded-full bg-raised p-1"
        >
          {(["N", "U"] as const).map((c) => (
            <Link
              key={c}
              role="tab"
              aria-selected={cond === c}
              href={qs({ c: c === "U" ? "U" : null })}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${cond === c ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {c === "N" ? "New changes" : "Used changes"}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={q ? "No tracked set matches" : "No sets tracked yet"}
            body="Use “Find on BrickLink” with the exact set number (for example 10497-1) to add it to the market."
          />
        </div>
      ) : (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left">
                <th className="label px-5 py-3 font-semibold">Set</th>
                <th className="label px-3 py-3 text-right font-semibold">New</th>
                <th className="label px-3 py-3 text-right font-semibold">Used</th>
                <th className="label px-3 py-3 text-right font-semibold">24 h</th>
                <th className="label px-3 py-3 text-right font-semibold">7 d</th>
                <th className="label px-3 py-3 text-right font-semibold">30 d</th>
                <th className="label px-5 py-3 text-right font-semibold">Sold (6 mo)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ set, byCondition }) => {
                const c = byCondition[cond];
                const sold = (byCondition.N.unitsSold ?? 0) + (byCondition.U.unitsSold ?? 0);
                const anySold =
                  byCondition.N.unitsSold !== null || byCondition.U.unitsSold !== null;
                return (
                  <tr key={set.id} className="transition hover:bg-raised/60">
                    <td className="px-5 py-3">
                      <Link
                        href={`/market/${set.itemType}/${encodeURIComponent(set.itemNumber)}?condition=${cond}`}
                        className="flex items-center gap-3"
                      >
                        <SetImage src={set.thumbnailUrl ?? set.imageUrl} alt="" size={44} />
                        <div className="min-w-0">
                          <div className="max-w-[260px] truncate font-semibold">{set.name}</div>
                          <div className="text-xs text-muted">
                            {set.itemNumber}
                            {set.theme ? ` · ${set.theme}` : ""}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {byCondition.N.price !== null ? (
                        money(byCondition.N.price)
                      ) : (
                        <span className="text-xs font-medium text-muted">No data</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {byCondition.U.price !== null ? (
                        money(byCondition.U.price)
                      ) : (
                        <span className="text-xs font-medium text-muted">No data</span>
                      )}
                    </td>
                    {(["1D", "1W", "1M"] as const).map((k) => (
                      <td
                        key={k}
                        className={`px-3 py-3 text-right font-semibold tabular-nums ${toneClass(c.changes[k]?.pct)}`}
                      >
                        {c.changes[k] ? pct(c.changes[k]!.pct) : "—"}
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right tabular-nums">
                      {anySold ? count(sold) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-5 pb-4 pt-1 text-xs text-muted">
            “—” means the app has not collected BrickLink observations far enough back for that
            period.
          </p>
        </div>
      )}
    </div>
  );
}
