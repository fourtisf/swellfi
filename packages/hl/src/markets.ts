import type { InfoClient } from "./info";
import type { PerpAssetCtx, PerpMeta } from "./types";

export type MarketKind = "crypto" | "tradfi";

export interface Market {
  /** Coin name as Hyperliquid uses it: "BTC", or "xyz:NVDA" on a HIP-3 dex. */
  name: string;
  /** "" for the main perp dex, otherwise the HIP-3 dex name. */
  dex: string;
  kind: MarketKind;
  /** Asset id used in exchange actions. */
  assetId: number;
  szDecimals: number;
  maxLev: number;
  onlyIsolated: boolean;
  px: number;
  prev: number;
  /** 24h notional volume, USD */
  vol: number;
  /** Open interest, USD */
  oi: number;
  /** Hourly funding rate, percent */
  fund: number;
}

/**
 * Asset ids: main-dex perps use their index in `meta.universe`; HIP-3 perps use
 * 100000 + perpDexIndex * 10000 + indexInMeta. Verified against the docs in NOTES.md.
 */
export function assetIdFor(dexIndex: number, indexInMeta: number): number {
  return dexIndex === 0 ? indexInMeta : 100_000 + dexIndex * 10_000 + indexInMeta;
}

/** Display name without the HIP-3 dex prefix: "xyz:NVDA" -> "NVDA". */
export const displayName = (name: string) => {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
};

export function parseMarkets(meta: PerpMeta, ctxs: PerpAssetCtx[], dex = "", dexIndex = 0): Market[] {
  const out: Market[] = [];
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    if (!c || u.isDelisted) return;
    const px = +(c.markPx || c.midPx || 0);
    if (!(px > 0)) return;
    const prev = +(c.prevDayPx || px);
    out.push({
      name: u.name,
      dex,
      kind: dex ? "tradfi" : "crypto",
      assetId: assetIdFor(dexIndex, i),
      szDecimals: u.szDecimals,
      maxLev: u.maxLeverage || 10,
      onlyIsolated: Boolean(u.onlyIsolated),
      px,
      prev,
      vol: +(c.dayNtlVlm || 0),
      oi: +(c.openInterest || 0) * px,
      fund: +(c.funding || 0) * 100,
    });
  });
  return out;
}

/**
 * Loads the main perp universe plus the configured HIP-3 dexes, sorted by 24h volume.
 * A HIP-3 dex that fails to load (or doesn't exist on this network) is skipped.
 */
export async function loadMarkets(info: InfoClient, hip3Dexes: string[] = []): Promise<Market[]> {
  const [meta, ctxs] = await info.metaAndAssetCtxs();
  let list = parseMarkets(meta, ctxs);
  if (hip3Dexes.length) {
    let dexNames: string[] = [];
    try {
      dexNames = (await info.perpDexs()).map((d) => (d ? d.name : ""));
    } catch {
      dexNames = [];
    }
    const extra = await Promise.all(
      hip3Dexes.map(async (dex) => {
        const dexIndex = dexNames.indexOf(dex);
        // Listed by perpDexs but not on this network: skip. If perpDexs itself failed we
        // still show prices, but without an asset id the market can't be traded.
        if (dexNames.length && dexIndex <= 0) return [];
        try {
          const [m, c] = await info.metaAndAssetCtxs(dex);
          const list = parseMarkets(m, c, dex, Math.max(dexIndex, 1));
          return dexIndex > 0 ? list : list.map((x) => ({ ...x, assetId: -1 }));
        } catch {
          return [];
        }
      }),
    );
    list = list.concat(extra.flat());
  }
  return list.sort((a, b) => b.vol - a.vol);
}

/** 24h change in percent against the given live price. */
export const change24h = (m: Pick<Market, "px" | "prev">, livePx?: number) => {
  const p = livePx ?? m.px;
  return m.prev ? (p / m.prev - 1) * 100 : 0;
};
