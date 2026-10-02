import { createPublicClient, fallback, http, type Chain, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia, avalanche, base, bsc, mainnet, optimism, polygon } from "viem/chains";

// Networks the app can switch a wallet to (deposit origins and Arbitrum Sepolia), and their RPCs.
// Token contracts live in chains.ts, which only the Deposit modal loads.

export const ORIGIN_CHAINS: Chain[] = [arbitrum, mainnet, base, optimism, bsc, polygon, avalanche];
const ALL_CHAINS: Chain[] = [...ORIGIN_CHAINS, arbitrumSepolia];

/** viem chain for an id the app can switch a wallet to. */
export function chainById(id: number): Chain {
  const c = ALL_CHAINS.find((x) => x.id === id);
  if (!c) throw new Error(`Unsupported network (chain ${id})`);
  return c;
}

export const networkLogo = (chainId: number) => `/networks/${chainId}.svg`;

/** Optional RPC overrides, e.g. NEXT_PUBLIC_RPC_URLS={"1":"https://…","8453":"https://…"}. */
function rpcOverrides(): Record<string, string> {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_RPC_URLS || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

// Second public RPC per chain, used when the first one fails or rate-limits.
export const BACKUP_RPC: Record<number, string> = {
  42161: "https://arbitrum-one-rpc.publicnode.com",
  1: "https://ethereum-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  43114: "https://avalanche-c-chain-rpc.publicnode.com",
};

export function rpcUrl(chain: Chain): string {
  if (chain.id === arbitrum.id && process.env.NEXT_PUBLIC_ARB_RPC_URL) return process.env.NEXT_PUBLIC_ARB_RPC_URL;
  return rpcOverrides()[String(chain.id)] || chain.rpcUrls.default.http[0]!;
}

const publics = new Map<number, PublicClient>();
export function publicClientFor(chain: Chain): PublicClient {
  let c = publics.get(chain.id);
  if (!c) {
    const urls = [rpcUrl(chain), BACKUP_RPC[chain.id]].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
    c = createPublicClient({ chain, transport: urls.length > 1 ? fallback(urls.map((u) => http(u))) : http(urls[0]) }) as PublicClient;
    publics.set(chain.id, c);
  }
  return c;
}
