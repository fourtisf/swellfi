// Pure helpers: Hyperliquid fills -> feed events and daily stats. No I/O, so they are unit-tested.

/** The fields of a Hyperliquid user fill the indexer uses (see the userFills info request). */
export interface HlFill {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  fee: string;
  feeToken?: string;
  builderFee?: string;
  tid: number;
  liquidation?: unknown;
}

// Per user: when two Swellfi users trade against each other, both of their fills carry the
// same hash and tid.
export const fillId = (userId: string, f: Pick<HlFill, "hash" | "tid">) => `${userId}:${f.hash}:${f.tid}`;

/** Spot fills ("@107", "PURR/USDC") aren't perp trades and stay out of the feed. */
export const isPerp = (coin: string) => !coin.startsWith("@") && !coin.includes("/");

type Side = "long" | "short";

/** One fill's opening and/or closing part. A flip ("Long > Short") is both. */
interface Part {
  kind: "open" | "close";
  side: Side;
  sz: number;
  px: number;
  closedPnl: number;
  fee: number;
  time: number;
  liquidated: boolean;
}

const num = (v: string | number | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Fees are only comparable to PnL when paid in USDC (perps always are). */
const usdcFee = (f: HlFill) => (!f.feeToken || f.feeToken === "USDC" ? num(f.fee) : 0);

export function partsOf(f: HlFill): Part[] {
  if (!isPerp(f.coin)) return [];
  const sz = num(f.sz), px = num(f.px), fee = usdcFee(f), time = f.time, liquidated = f.liquidation != null;
  if (!(sz > 0) || !(px > 0)) return [];
  const dir = f.dir.trim();
  const base = { px, time, liquidated };
  const m = /^(Long|Short) > (Long|Short)$/.exec(dir);
  if (m) {
    // Flip: the old position closes in full, the rest opens the other way.
    const closing = Math.min(Math.abs(num(f.startPosition)), sz);
    const opening = sz - closing;
    const parts: Part[] = [];
    if (closing > 0) parts.push({ ...base, kind: "close", side: m[1]!.toLowerCase() as Side, sz: closing, closedPnl: num(f.closedPnl), fee: (fee * closing) / sz });
    if (opening > 0) parts.push({ ...base, kind: "open", side: m[2]!.toLowerCase() as Side, sz: opening, closedPnl: 0, fee: (fee * opening) / sz });
    return parts;
  }
  const o = /^Open (Long|Short)$/.exec(dir);
  if (o) return [{ ...base, kind: "open", side: o[1]!.toLowerCase() as Side, sz, closedPnl: 0, fee }];
  const c = /^Close (Long|Short)$/.exec(dir);
  if (c) return [{ ...base, kind: "close", side: c[1]!.toLowerCase() as Side, sz, closedPnl: num(f.closedPnl), fee }];
  // Liquidations of a long are sells, of a short buys; HL marks them with `liquidation`.
  if (liquidated && /liquidat/i.test(dir)) {
    const side: Side = f.side === "A" ? "long" : "short";
    return [{ ...base, kind: "close", side, sz, closedPnl: num(f.closedPnl), fee }];
  }
  return [];
}

export interface FeedEvent {
  id: string;
  kind: "open" | "close";
  createdAt: Date;
  data: {
    coin: string;
    side: Side;
    oid: number;
    /** Coins traded. */
    sz: number;
    /** Notional in USD at the fill price. */
    size: number;
    /** Average fill price (entry for opens, exit for closes). */
    px: number;
    lev?: number;
    /** Closes only: net PnL (closed PnL minus fees), entry and exit price. */
    pnl?: number;
    entry?: number;
    exit?: number;
    liquidated?: boolean;
  };
}

const round = (v: number, d = 8) => Number(v.toFixed(d));

/**
 * Group fills into one event per (order, open|close). Fills of an order arriving over several
 * polls are always regrouped from everything stored, so the event converges to the full order.
 */
export function buildEvents(userId: string, fills: HlFill[], levByCoin: Record<string, number> = {}): FeedEvent[] {
  const groups = new Map<string, { coin: string; oid: number; parts: Part[] }>();
  for (const f of fills) {
    for (const p of partsOf(f)) {
      const k = `${f.oid}:${p.kind}`;
      const g = groups.get(k) ?? { coin: f.coin, oid: f.oid, parts: [] };
      g.parts.push(p);
      groups.set(k, g);
    }
  }
  const out: FeedEvent[] = [];
  for (const [k, g] of groups) {
    const kind = k.endsWith(":open") ? "open" : "close";
    const sz = g.parts.reduce((s, p) => s + p.sz, 0);
    const notional = g.parts.reduce((s, p) => s + p.sz * p.px, 0);
    const px = notional / sz;
    const side = g.parts[0]!.side;
    const lev = levByCoin[g.coin];
    const createdAt = new Date(Math.min(...g.parts.map((p) => p.time)));
    const data: FeedEvent["data"] = { coin: g.coin, side, oid: g.oid, sz: round(sz), size: round(notional, 2), px: round(px), ...(lev ? { lev } : {}) };
    if (kind === "close") {
      const gross = g.parts.reduce((s, p) => s + p.closedPnl, 0);
      const fees = g.parts.reduce((s, p) => s + p.fee, 0);
      // closedPnl = (exit - entry) * sz for longs, (entry - exit) * sz for shorts.
      const entry = side === "long" ? px - gross / sz : px + gross / sz;
      Object.assign(data, { pnl: round(gross - fees, 6), entry: round(entry), exit: round(px), ...(g.parts.some((p) => p.liquidated) ? { liquidated: true } : {}) });
    }
    out.push({ id: `fill:${userId}:${g.oid}:${kind}`, kind, createdAt, data });
  }
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export interface DayStat {
  date: Date;
  pnl: number;
  volume: number;
  trades: number;
  closedTrades: number;
  wins: number;
}

export const utcDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Daily PnL (closed PnL minus fees), volume and trade counts from one day's perp fills. */
export function rollupDays(fills: HlFill[]): DayStat[] {
  const days = new Map<number, { pnl: number; volume: number; orders: Set<number>; closes: Map<number, number> }>();
  for (const f of fills) {
    const parts = partsOf(f);
    if (!parts.length) continue;
    const day = utcDay(f.time).getTime();
    const d = days.get(day) ?? { pnl: 0, volume: 0, orders: new Set<number>(), closes: new Map<number, number>() };
    d.volume += num(f.sz) * num(f.px);
    d.orders.add(f.oid);
    for (const p of parts) {
      d.pnl += p.closedPnl - p.fee;
      if (p.kind === "close") d.closes.set(f.oid, (d.closes.get(f.oid) ?? 0) + p.closedPnl - p.fee);
    }
    days.set(day, d);
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, d]) => ({
      date: new Date(day),
      pnl: round(d.pnl, 6),
      volume: round(d.volume, 2),
      trades: d.orders.size,
      closedTrades: d.closes.size,
      wins: [...d.closes.values()].filter((v) => v > 0).length,
    }));
}

/** End-of-day account value per UTC day from a portfolio accountValueHistory ([ms, "value"][]). */
export function equityByDay(history: [number, string][]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [t, v] of [...history].sort((a, b) => a[0] - b[0])) {
    const n = Number(v);
    if (Number.isFinite(n)) out.set(utcDay(t).getTime(), n);
  }
  return out;
}
