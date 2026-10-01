import { Prisma } from "@swellfi/db";

type Decimal = Prisma.Decimal;
const Dec = Prisma.Decimal;
const ZERO = new Dec(0);

export const TIMEFRAMES = ["24h", "7d", "30d", "all"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const TF_DAYS: Record<Timeframe, number> = { "24h": 1, "7d": 7, "30d": 30, all: Number.POSITIVE_INFINITY };
/** Points in the equity sparkline per timeframe (prototype: 4 / 16 / 30 / 60). */
const SPARK_POINTS: Record<Timeframe, number> = { "24h": 4, "7d": 16, "30d": 30, all: 60 };

export interface StatRow {
  date: Date;
  pnl: Decimal;
  volume: Decimal;
  equity: Decimal;
  trades: number;
  closedTrades: number;
  wins: number;
}

export interface Summary {
  pnl: string;
  /** percent */
  roi: number;
  volume: string;
  equity: string;
  trades: number;
  /** percent, null without closed trades */
  winRate: number | null;
  /** percent, <= 0 */
  maxDrawdown: number;
  series: number[];
}

export const startOfUtcDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** First day (inclusive) of a timeframe window ending today. */
export function windowStart(tf: Timeframe, today = startOfUtcDay()): Date | null {
  const days = TF_DAYS[tf];
  return Number.isFinite(days) ? new Date(today.getTime() - (days - 1) * 864e5) : null;
}

/**
 * Summarizes daily rows (any order) over a timeframe. ROI is PnL over the account value
 * at the start of the window. This is simple ROI: deposits and withdrawals inside the
 * window distort it until the Phase 3 indexer tracks net flows.
 */
export function summarize(rowsIn: StatRow[], tf: Timeframe, today = startOfUtcDay()): Summary {
  const rows = [...rowsIn].sort((a, b) => a.date.getTime() - b.date.getTime());
  const from = windowStart(tf, today);
  const firstIdx = from ? rows.findIndex((r) => r.date >= from) : 0;
  const win = firstIdx === -1 ? [] : rows.slice(firstIdx);
  const before = firstIdx > 0 ? rows[firstIdx - 1] : undefined;

  let pnl = ZERO;
  let volume = ZERO;
  let trades = 0;
  let closed = 0;
  let wins = 0;
  for (const r of win) {
    pnl = pnl.add(r.pnl);
    volume = volume.add(r.volume);
    trades += r.trades;
    closed += r.closedTrades;
    wins += r.wins;
  }

  const first = win[0];
  const startEq = before ? before.equity : first ? first.equity.sub(first.pnl) : ZERO;
  const roi = startEq.gt(0) ? pnl.div(startEq).mul(100).toNumber() : 0;

  const eqSeries = [startEq, ...win.map((r) => r.equity)].filter((v) => v.gt(0));
  let peak = ZERO;
  let dd = 0;
  for (const e of eqSeries) {
    if (e.gt(peak)) peak = e;
    if (peak.gt(0)) dd = Math.min(dd, e.div(peak).sub(1).mul(100).toNumber());
  }

  const n = Math.max(SPARK_POINTS[tf], 4);
  const series = rows.slice(-n).map((r) => r.equity.toNumber());
  const last = rows[rows.length - 1];

  return {
    pnl: pnl.toFixed(2),
    roi,
    volume: volume.toFixed(2),
    equity: last ? last.equity.toFixed(2) : "0.00",
    trades,
    winRate: closed ? (wins / closed) * 100 : null,
    maxDrawdown: dd,
    series,
  };
}
