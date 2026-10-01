// Order-panel estimates (from the prototype). These are previews only: Hyperliquid
// computes the real liquidation price and fees when the order fills.

/** Base-tier perp fees. Verify against the current fee schedule (see NOTES.md). */
export const HL_FEES = { taker: 0.00045, maker: 0.00015 } as const;

export type OrderType = "market" | "limit" | "stop" | "stopLimit";
export type Side = "long" | "short";

export interface OrderEstimateInput {
  side: Side;
  type: OrderType;
  /** Entry / limit / trigger price */
  px: number;
  /** Margin committed, USD */
  margin: number;
  leverage: number;
  /** Max leverage of the asset; maintenance margin is half the initial margin at max leverage. */
  maxLeverage: number;
  /** Builder fee as a rate (0.0005 = 0.05%). */
  builderRate: number;
}

export interface OrderEstimate {
  notional: number;
  margin: number;
  liqPx: number;
  fee: number;
  feeRate: number;
}

export function maintenanceMarginRate(maxLeverage: number) {
  return 1 / (2 * maxLeverage);
}

/** Isolated-style liquidation estimate: entry * (1 - dir * (1/lev - mmr)). */
export function estimateLiqPx(side: Side, px: number, leverage: number, maxLeverage: number) {
  const dir = side === "long" ? 1 : -1;
  return Math.max(0, px * (1 - dir * (1 / leverage - maintenanceMarginRate(maxLeverage))));
}

export function feeRateFor(type: OrderType, builderRate: number) {
  // Resting limit orders usually add liquidity; market and stop-market orders take it.
  return (type === "limit" ? HL_FEES.maker : HL_FEES.taker) + builderRate;
}

export function estimateOrder(i: OrderEstimateInput): OrderEstimate {
  const notional = i.margin * i.leverage;
  const feeRate = feeRateFor(i.type, i.builderRate);
  return {
    notional,
    margin: i.margin,
    liqPx: estimateLiqPx(i.side, i.px, i.leverage, i.maxLeverage),
    fee: notional * feeRate,
    feeRate,
  };
}
