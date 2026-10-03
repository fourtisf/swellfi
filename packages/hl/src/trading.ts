// Pure order construction for Hyperliquid's `order` action. No signing, no I/O, so it can be
// unit-tested; `exchange.ts` hands the result to the SDK, which signs with the agent key.
import type { OrderParameters } from "@nktkas/hyperliquid/api/exchange";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import type { Market } from "./markets";
import type { Side } from "./math";

/** Hyperliquid rejects orders below $10 notional (MinTradeNtl). */
export const MIN_ORDER_USD = 10;
/** Default slippage for market and stop-market orders. */
export const DEFAULT_SLIPPAGE = 0.03;

export class OrderInputError extends Error {
  constructor(
    readonly code: "NO_BUILDER" | "MIN_NOTIONAL" | "BAD_PRICE" | "BAD_SIZE" | "BAD_TPSL" | "NOT_TRADABLE",
    message: string,
  ) {
    super(message);
    this.name = "OrderInputError";
  }
}

export interface Builder {
  address: string | null;
  feeTenthsBps: number;
}

export interface OrderIntent {
  market: Pick<Market, "name" | "assetId" | "szDecimals">;
  side: Side;
  type: "market" | "limit" | "stop" | "stopLimit";
  /** Current mid; used for market slippage and stop trigger direction. */
  mid: number;
  /** Limit price (limit) or trigger price (stop, stopLimit). Ignored for market orders. */
  px?: number;
  /** stopLimit only: limit price once triggered. */
  limitPx?: number;
  /** Order size in coin units (before rounding). */
  size: number;
  reduceOnly?: boolean;
  /** Limit only: add-liquidity-only (ALO). */
  postOnly?: boolean;
  slippage?: number;
  /** Optional take-profit / stop-loss trigger prices, attached as normalTpsl children. */
  tp?: number;
  sl?: number;
  builder: Builder;
}

type WireOrder = OrderParameters["orders"][number];

const px = (v: number, szDecimals: number) => {
  if (!(v > 0) || !Number.isFinite(v)) throw new OrderInputError("BAD_PRICE", "Enter a valid price");
  return formatPrice(v, szDecimals);
};

const sz = (v: number, szDecimals: number) => {
  if (!(v > 0)) throw new OrderInputError("BAD_SIZE", "Enter a size");
  try {
    return formatSize(v, szDecimals);
  } catch {
    throw new OrderInputError("BAD_SIZE", "Size is below the minimum lot for this market");
  }
};

/** Aggressive limit price that crosses the book by `slippage` (how HL market orders work). */
export const slippagePx = (ref: number, isBuy: boolean, slippage = DEFAULT_SLIPPAGE) => ref * (isBuy ? 1 + slippage : 1 - slippage);

/** The builder object every order must carry. Throws if the platform builder isn't configured. */
export function builderParam(b: Builder) {
  if (!b.address || !/^0x[0-9a-fA-F]{40}$/.test(b.address)) {
    throw new OrderInputError("NO_BUILDER", "Trading is disabled: the platform builder address isn't configured");
  }
  if (!Number.isInteger(b.feeTenthsBps) || b.feeTenthsBps < 0 || b.feeTenthsBps > 100) {
    throw new OrderInputError("NO_BUILDER", "Builder fee must be 0–100 tenths of a bp on perps");
  }
  return { b: b.address.toLowerCase() as `0x${string}`, f: b.feeTenthsBps };
}

/**
 * Builds the `order` action params: entry order (+ TP/SL children), rounded to Hyperliquid's
 * tick/lot rules, with the builder fee attached.
 */
export function buildOrder(i: OrderIntent): OrderParameters {
  const { market: m } = i;
  if (m.assetId < 0) throw new OrderInputError("NOT_TRADABLE", `${m.name} can't be traded right now`);
  const builder = builderParam(i.builder);
  const isBuy = i.side === "long";
  const slip = i.slippage ?? DEFAULT_SLIPPAGE;
  const s = sz(i.size, m.szDecimals);

  let entry: WireOrder;
  let refPx: number;
  if (i.type === "market") {
    refPx = i.mid;
    entry = { a: m.assetId, b: isBuy, p: px(slippagePx(i.mid, isBuy, slip), m.szDecimals), s, r: Boolean(i.reduceOnly), t: { limit: { tif: "Ioc" } } };
  } else if (i.type === "limit") {
    refPx = i.px ?? 0;
    entry = { a: m.assetId, b: isBuy, p: px(refPx, m.szDecimals), s, r: Boolean(i.reduceOnly), t: { limit: { tif: i.postOnly ? "Alo" : "Gtc" } } };
  } else {
    refPx = i.px ?? 0;
    const trigger = px(refPx, m.szDecimals);
    // A buy stop above the market (or a sell stop below) behaves like a stop loss; the other
    // side behaves like a take profit. Hyperliquid triggers off the mark price.
    const breakout = isBuy ? refPx > i.mid : refPx < i.mid;
    const isMarket = i.type === "stop";
    entry = {
      a: m.assetId,
      b: isBuy,
      p: px(isMarket ? slippagePx(refPx, isBuy, slip) : (i.limitPx ?? 0), m.szDecimals),
      s,
      r: Boolean(i.reduceOnly),
      t: { trigger: { isMarket, triggerPx: trigger, tpsl: breakout ? "sl" : "tp" } },
    };
  }

  const notional = Number(s) * refPx;
  if (!i.reduceOnly && notional < MIN_ORDER_USD) {
    throw new OrderInputError("MIN_NOTIONAL", `Minimum order value is $${MIN_ORDER_USD}`);
  }

  const children: WireOrder[] = [];
  const child = (trigger: number, kind: "tp" | "sl"): WireOrder => ({
    a: m.assetId,
    b: !isBuy,
    p: px(slippagePx(trigger, !isBuy, slip), m.szDecimals),
    s,
    r: true,
    t: { trigger: { isMarket: true, triggerPx: px(trigger, m.szDecimals), tpsl: kind } },
  });
  if (i.tp) {
    if (isBuy ? i.tp <= refPx : i.tp >= refPx) throw new OrderInputError("BAD_TPSL", `Take profit must be ${isBuy ? "above" : "below"} the entry price`);
    children.push(child(i.tp, "tp"));
  }
  if (i.sl) {
    if (isBuy ? i.sl >= refPx : i.sl <= refPx) throw new OrderInputError("BAD_TPSL", `Stop loss must be ${isBuy ? "below" : "above"} the entry price`);
    children.push(child(i.sl, "sl"));
  }

  return { orders: [entry, ...children], grouping: children.length ? "normalTpsl" : "na", builder };
}

/**
 * Reduce-only order that closes (part of) a position: IOC at market, or a resting GTC limit at
 * `limitPx`. A limit already through the market fills right away at that price or better.
 */
export function buildClose(p: { market: Pick<Market, "name" | "assetId" | "szDecimals">; szi: number; mid: number; fraction?: number; size?: number; slippage?: number; limitPx?: number; builder: Builder }): OrderParameters {
  const isBuy = p.szi < 0;
  const f = p.fraction ?? 1;
  if (!(f > 0 && f <= 1)) throw new OrderInputError("BAD_SIZE", "Choose how much of the position to close");
  if (p.size != null && !(p.size > 0 && p.size <= Math.abs(p.szi) * (1 + 1e-9))) throw new OrderInputError("BAD_SIZE", "Choose how much of the position to close");
  // Sizes are truncated to whole lots: nudge up by a hair so 0.0042 computed as 0.00419999…
  // doesn't lose a lot (the nudge is far below one lot).
  const size = (p.size ?? Math.abs(p.szi) * f) * (1 + 1e-9);
  const limit = p.limitPx != null;
  const price = limit ? px(p.limitPx!, p.market.szDecimals) : px(slippagePx(p.mid, isBuy, p.slippage ?? DEFAULT_SLIPPAGE), p.market.szDecimals);
  return {
    orders: [{ a: p.market.assetId, b: isBuy, p: price, s: sz(size, p.market.szDecimals), r: true, t: { limit: { tif: limit ? "Gtc" : "Ioc" } } }],
    grouping: "na",
    builder: builderParam(p.builder),
  };
}

/** Position-level TP/SL (positionTpsl): sized to the whole position, adjusts as it changes. */
export function buildPositionTpsl(p: { market: Pick<Market, "name" | "assetId" | "szDecimals">; szi: number; tp?: number; sl?: number; slippage?: number; builder: Builder }): OrderParameters {
  const isBuy = p.szi < 0; // closing side
  const slip = p.slippage ?? DEFAULT_SLIPPAGE;
  const size = sz(Math.abs(p.szi), p.market.szDecimals);
  const orders: WireOrder[] = [];
  for (const [kind, trig] of [["tp", p.tp], ["sl", p.sl]] as const) {
    if (!trig) continue;
    orders.push({ a: p.market.assetId, b: isBuy, p: px(slippagePx(trig, isBuy, slip), p.market.szDecimals), s: size, r: true, t: { trigger: { isMarket: true, triggerPx: px(trig, p.market.szDecimals), tpsl: kind } } });
  }
  if (!orders.length) throw new OrderInputError("BAD_TPSL", "Set a take profit or stop loss");
  return { orders, grouping: "positionTpsl", builder: builderParam(p.builder) };
}

type Status = { resting: { oid: number } } | { filled: { totalSz: string; avgPx: string; oid: number } } | { error: string } | "waitingForFill" | "waitingForTrigger" | string;

/** Human summary of an order response's per-order statuses. Throws on the first error. */
export function summarizeStatuses(statuses: Status[]): string {
  const first = statuses[0];
  for (const s of statuses) if (typeof s === "object" && s && "error" in s) throw new Error(s.error);
  if (typeof first === "object" && first && "filled" in first) return `Filled ${first.filled.totalSz} at ${first.filled.avgPx}`;
  if (typeof first === "object" && first && "resting" in first) return "Order placed";
  if (first === "waitingForTrigger") return "Stop order placed";
  return "Order sent";
}

// ---------- Account parsing ----------

export interface AccountPosition {
  coin: string;
  dex: string;
  szi: number;
  entryPx: number;
  positionValue: number;
  unrealizedPnl: number;
  returnOnEquity: number;
  liquidationPx: number | null;
  marginUsed: number;
  leverage: { type: "cross" | "isolated"; value: number };
  cumFundingSinceOpen: number;
}

export interface ClearinghouseLike {
  assetPositions: { position: { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; returnOnEquity: string; liquidationPx: string | null; marginUsed: string; leverage: { type: string; value: number }; cumFunding: { sinceOpen: string } } }[];
  marginSummary: { accountValue: string; totalMarginUsed: string; totalNtlPos: string };
  withdrawable: string;
}

export function parsePositions(state: ClearinghouseLike, dex = ""): AccountPosition[] {
  return state.assetPositions
    .map(({ position: p }) => ({
      coin: p.coin,
      dex,
      szi: +p.szi,
      entryPx: +p.entryPx,
      positionValue: +p.positionValue,
      unrealizedPnl: +p.unrealizedPnl,
      returnOnEquity: +p.returnOnEquity,
      liquidationPx: p.liquidationPx == null ? null : +p.liquidationPx,
      marginUsed: +p.marginUsed,
      leverage: { type: (p.leverage.type === "isolated" ? "isolated" : "cross") as "cross" | "isolated", value: p.leverage.value },
      cumFundingSinceOpen: +p.cumFunding.sinceOpen,
    }))
    .filter((p) => p.szi !== 0);
}

export interface AccountSummary {
  accountValue: number;
  withdrawable: number;
  marginUsed: number;
  notional: number;
  unrealizedPnl: number;
  /** total notional / account value */
  leverage: number;
}

export function summarizeAccount(states: ClearinghouseLike[], positions: AccountPosition[]): AccountSummary {
  let accountValue = 0;
  let withdrawable = 0;
  let marginUsed = 0;
  let notional = 0;
  for (const s of states) {
    accountValue += +s.marginSummary.accountValue;
    withdrawable += +s.withdrawable;
    marginUsed += +s.marginSummary.totalMarginUsed;
    notional += +s.marginSummary.totalNtlPos;
  }
  const unrealizedPnl = positions.reduce((a, p) => a + p.unrealizedPnl, 0);
  return { accountValue, withdrawable, marginUsed, notional, unrealizedPnl, leverage: accountValue > 0 ? notional / accountValue : 0 };
}

export interface FillLike {
  coin: string;
  px: string;
  sz: string;
  closedPnl: string;
  fee: string;
  builderFee?: string;
  time: number;
}

/** Terminal analytics row from fills. `fee` already includes the builder fee. */
export function fillAnalytics(fills: FillLike[]) {
  let realized = 0;
  let volume = 0;
  let fees = 0;
  let builderFees = 0;
  let wins = 0;
  let closed = 0;
  let best = 0;
  for (const f of fills) {
    const pnl = +f.closedPnl;
    realized += pnl;
    volume += +f.px * +f.sz;
    fees += +f.fee;
    builderFees += +(f.builderFee ?? 0);
    if (pnl !== 0) {
      closed++;
      if (pnl > 0) wins++;
      best = Math.max(best, pnl);
    }
  }
  return { realized, volume, fees, builderFees, closed, winRate: closed ? (wins / closed) * 100 : null, best: best || null };
}
