// Response shapes of the Hyperliquid info API and WebSocket feed that we consume.
// Numbers arrive as strings and are converted at the edge.

export interface UniverseAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  marginMode?: string;
}

export interface PerpMeta {
  universe: UniverseAsset[];
}

export interface PerpAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium?: string | null;
  oraclePx?: string;
  markPx: string;
  midPx?: string | null;
  impactPxs?: string[] | null;
  dayBaseVlm?: string;
}

export type MetaAndAssetCtxs = [PerpMeta, PerpAssetCtx[]];

/** Entry of the `perpDexs` response. Index 0 is the main dex and comes back as null. */
export type PerpDex = { name: string; fullName?: string; deployer?: string } | null;

export interface RawCandle {
  t: number; // open time ms
  T: number; // close time ms
  s: string; // coin
  i: string; // interval
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface RawBookLevel {
  px: string;
  sz: string;
  n: number;
}

export interface L2Book {
  coin: string;
  time: number;
  levels: [RawBookLevel[], RawBookLevel[]]; // [bids, asks]
}

export interface RawTrade {
  coin: string;
  side: "B" | "A";
  px: string;
  sz: string;
  time: number;
  hash: string;
  tid: number;
}

export interface Trade {
  side: "B" | "A";
  px: number;
  sz: number;
  time: number;
}

export const CANDLE_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};
