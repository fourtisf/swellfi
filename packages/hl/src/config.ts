export type HlNetwork = "mainnet" | "testnet";

export const HL_ENDPOINTS: Record<HlNetwork, { api: string; ws: string }> = {
  mainnet: { api: "https://api.hyperliquid.xyz", ws: "wss://api.hyperliquid.xyz/ws" },
  testnet: { api: "https://api.hyperliquid-testnet.xyz", ws: "wss://api.hyperliquid-testnet.xyz/ws" },
};

export interface HlConfigInput {
  network?: string;
  dataNetwork?: string;
  hip3Dexes?: string;
  infoUrl?: string;
  wsUrl?: string;
  builderAddress?: string;
  builderFeeTenthsBps?: string;
}

export interface HlConfig {
  /** Network orders are sent to. */
  network: HlNetwork;
  /** Network market data is read from (defaults to `network`). */
  dataNetwork: HlNetwork;
  infoUrl: string;
  exchangeUrl: string;
  wsUrl: string;
  /** HIP-3 perp dexes listed next to the main dex (e.g. "xyz" for stocks and commodities). */
  hip3Dexes: string[];
  builder: { address: string | null; feeTenthsBps: number };
}

function asNetwork(v: string | undefined, fallback: HlNetwork): HlNetwork {
  return v === "mainnet" || v === "testnet" ? v : fallback;
}

/**
 * Builds the Hyperliquid config from env values. Callers pass env values explicitly so
 * Next.js can inline NEXT_PUBLIC_* variables at build time. Anything unknown falls back
 * to testnet: mainnet has to be asked for by name.
 */
export function resolveHlConfig(input: HlConfigInput): HlConfig {
  const network = asNetwork(input.network, "testnet");
  const dataNetwork = asNetwork(input.dataNetwork || undefined, network);
  const fee = Number.parseInt(input.builderFeeTenthsBps ?? "", 10);
  return {
    network,
    dataNetwork,
    infoUrl: input.infoUrl || `${HL_ENDPOINTS[dataNetwork].api}/info`,
    exchangeUrl: `${HL_ENDPOINTS[network].api}/exchange`,
    wsUrl: input.wsUrl || HL_ENDPOINTS[dataNetwork].ws,
    hip3Dexes: (input.hip3Dexes ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    builder: {
      address: input.builderAddress ? input.builderAddress.toLowerCase() : null,
      feeTenthsBps: Number.isFinite(fee) && fee >= 0 ? fee : 0,
    },
  };
}

/** 50 tenths of a bp -> 0.0005 */
export const tenthsBpsToRate = (tenths: number) => tenths / 100_000;

/** 50 tenths of a bp -> "0.05%" (the string format approveBuilderFee takes). */
export const tenthsBpsToPercentString = (tenths: number) =>
  `${Number((tenths / 1000).toFixed(4))}%`;
