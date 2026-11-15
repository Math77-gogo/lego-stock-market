/**
 * Minimal message catalog. English ships first; add `fr` with the same keys to localize.
 * Components read strings through `t()` so a locale switch needs no component changes.
 */
const en = {
  "nav.dashboard": "Home",
  "nav.portfolio": "Portfolio",
  "nav.market": "Market",
  "nav.analytics": "Analytics",
  "nav.leaderboard": "Rankings",
  "nav.settings": "Settings",
  "data.insufficient": "Insufficient BrickLink data",
  "data.notEnoughHistory": "Not enough historical data",
  "data.source": "Source: BrickLink Price Guide (official API)",
  "dashboard.total": "Total portfolio value",
  "dashboard.today": "Today",
  "dashboard.topPerformers": "My top performers",
  "dashboard.holdings": "My holdings",
} as const;

export type MessageKey = keyof typeof en;
export type Locale = "en";
const catalogs: Record<Locale, Record<MessageKey, string>> = { en };

export function t(key: MessageKey, locale: Locale = "en"): string {
  return catalogs[locale][key] ?? en[key];
}
