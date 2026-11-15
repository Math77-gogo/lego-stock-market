const cad = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const cadCompact = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("en-CA");

export const MISSING = "—";

export function money(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? MISSING : cad.format(v);
}
export function moneyCompact(v: number): string {
  return Math.abs(v) >= 10_000 ? cadCompact.format(v) : cad.format(v);
}
export function signedMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  const s = cad.format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}
export function pct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}%` : v < 0 ? `−${s}%` : `${s}%`;
}
export function count(v: number | null | undefined): string {
  return v === null || v === undefined ? MISSING : int.format(v);
}
export function tone(v: number | null | undefined): "gain" | "loss" | "flat" {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "gain" : "loss";
}
export function toneClass(v: number | null | undefined): string {
  const t = tone(v);
  return t === "gain" ? "text-gain" : t === "loss" ? "text-loss" : "text-muted";
}
export const conditionLabel = (c: "N" | "U") => (c === "N" ? "New / Sealed" : "Used");
export const conditionShort = (c: "N" | "U") => (c === "N" ? "New" : "Used");

export function relativeAge(date: Date | string | number | null, now = Date.now()): string {
  if (!date) return "never";
  const ms = now - new Date(date).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
