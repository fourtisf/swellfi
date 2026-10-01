// Number and time formatting, ported from the prototype so every screen reads the same.

/** Price with precision scaled to magnitude: 96,420.5 · 212.40 · 2.410 · 0.27100 */
export function fPx(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  const a = Math.abs(p);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Plain numeric string for an input field (no thousands separators). */
export const pxInput = (p: number) => fPx(p).replace(/,/g, "");

/** $3.20B · $412.80K · $18.6K · $950.00 */
export function fUsd(n: number, dec = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export const fPct = (n: number, d = 2) => (n > 0 ? "+" : "") + n.toFixed(d) + "%";

/** CSS class for a signed value. */
export const sgn = (n: number) => (n >= 0 ? "up" : "dn");

export function ago(t: number, now = Date.now()): string {
  const s = (now - t) / 1e3;
  if (s < 60) return `${Math.max(1, s | 0)}s ago`;
  if (s < 3600) return `${(s / 60) | 0}m ago`;
  if (s < 86400) return `${(s / 3600) | 0}h ago`;
  return `${(s / 86400) | 0}d ago`;
}

export function fDur(ms: number): string {
  const m = (ms / 6e4) | 0;
  if (m < 60) return `${m}m`;
  const h = (m / 60) | 0;
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${(h / 24) | 0}d ${h % 24}h`;
}

/** mm:ss until the next hourly funding payment. */
export const fundingCountdown = (now = Date.now()) => new Date(3_600_000 - (now % 3_600_000)).toISOString().slice(14, 19);

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
