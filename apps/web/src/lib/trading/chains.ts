import type { Chain } from "viem";
import { arbitrum, avalanche, base, bsc, mainnet, optimism, polygon } from "viem/chains";

// Where deposits can come from. USDC on Arbitrum goes straight to Hyperliquid's Bridge2; every other
// token and network is routed by Relay into the Hyperliquid (HyperCore) perps account.
// Token addresses are the canonical contracts; decimals are re-checked on-chain before quoting.

export const NATIVE = "0x0000000000000000000000000000000000000000";

export interface DepositToken {
  symbol: string;
  /** NATIVE for the chain's gas coin. */
  address: `0x${string}`;
  decimals: number;
}

export interface DepositChain {
  chain: Chain;
  name: string;
  /** Label for the network picker. */
  short: string;
  tokens: DepositToken[];
}

const native = (c: Chain): DepositToken => ({ symbol: c.nativeCurrency.symbol, address: NATIVE, decimals: c.nativeCurrency.decimals });

export const DEPOSIT_CHAINS: DepositChain[] = [
  {
    chain: arbitrum,
    name: "Arbitrum One",
    short: "Arbitrum",
    tokens: [
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      native(arbitrum),
    ],
  },
  {
    chain: mainnet,
    name: "Ethereum",
    short: "Ethereum",
    tokens: [
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      native(mainnet),
    ],
  },
  {
    chain: base,
    name: "Base",
    short: "Base",
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
      native(base),
    ],
  },
  {
    chain: optimism,
    name: "Optimism",
    short: "Optimism",
    tokens: [
      { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
      { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
      native(optimism),
    ],
  },
  {
    chain: bsc,
    name: "BNB Chain",
    short: "BNB",
    tokens: [
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      native(bsc),
    ],
  },
  {
    chain: polygon,
    name: "Polygon",
    short: "Polygon",
    tokens: [
      { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      native(polygon),
    ],
  },
  {
    chain: avalanche,
    name: "Avalanche",
    short: "Avalanche",
    tokens: [
      { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
      { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
      native(avalanche),
    ],
  },
];

/** The deposit that skips Relay: USDC on Arbitrum, sent to Bridge2 directly. */
export const isDirectBridge = (chainId: number, token: DepositToken) => chainId === arbitrum.id && token.symbol === "USDC";
