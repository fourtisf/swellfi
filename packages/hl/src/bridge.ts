import type { HlNetwork } from "./config";

/**
 * Hyperliquid Bridge2 on Arbitrum (see NOTES.md). The docs mark the bridge "legacy" in favour
 * of CCTP but it remains the supported deposit path for USDC on Arbitrum.
 * Deposits are a plain USDC transfer to the bridge, credited to the sender in < 1 minute.
 */
export const BRIDGE: Record<HlNetwork, { chainId: number; chainName: string; bridge: `0x${string}`; usdc: `0x${string}`; rpcUrl: string; explorer: string }> = {
  mainnet: {
    chainId: 42161,
    chainName: "Arbitrum One",
    bridge: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
  },
  testnet: {
    chainId: 421614,
    chainName: "Arbitrum Sepolia",
    bridge: "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89",
    usdc: "0x1baAbB04529D43a73232B713C0FE471f7c7334d5",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
  },
};

/** Deposits below this are lost forever. */
export const MIN_DEPOSIT_USDC = 5;
/** withdraw3 fee charged by Hyperliquid ("at time of writing"); shown to the user before signing. */
export const WITHDRAW_FEE_USDC = 1;
export const USDC_DECIMALS = 6;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/** USDC decimal string -> base units, without floating point. */
export function toUsdcUnits(amount: string): bigint {
  const m = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(amount.trim());
  if (!m) throw new Error("Invalid amount");
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0"));
}

export const fromUsdcUnits = (u: bigint) => Number(u) / 1e6;

export function validateDeposit(amount: string, balanceUnits: bigint) {
  let units: bigint;
  try {
    units = toUsdcUnits(amount);
  } catch {
    return "Enter an amount";
  }
  if (units < BigInt(MIN_DEPOSIT_USDC) * 1_000_000n) return `Minimum deposit is ${MIN_DEPOSIT_USDC} USDC. Smaller deposits are lost.`;
  if (units > balanceUnits) return "Not enough USDC on Arbitrum";
  return null;
}

export function validateWithdraw(amount: string, withdrawable: number) {
  const n = Number(amount);
  if (!(n > 0)) return "Enter an amount";
  if (n <= WITHDRAW_FEE_USDC) return `Amount must be more than the ${WITHDRAW_FEE_USDC} USDC withdrawal fee`;
  if (n > withdrawable) return "More than your withdrawable balance";
  return null;
}
