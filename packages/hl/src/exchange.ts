import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import type { AbstractWallet } from "@nktkas/hyperliquid/signing";
import type { HlConfig, HlNetwork } from "./config";
import { tenthsBpsToPercentString } from "./config";

/** Agent name registered on Hyperliquid. The `valid_until` suffix is excluded from the 16-char limit. */
export const AGENT_NAME = "tideline";
/** Agents expire after this; Hyperliquid allows up to 180 days. */
export const AGENT_TTL_MS = 90 * 864e5;

const apiBase = (infoUrl: string) => infoUrl.replace(/\/info\/?$/, "");

/** HTTP transport for the trading network (exchange + user info). */
export function tradingTransport(cfg: Pick<HlConfig, "network" | "infoUrl" | "dataNetwork">) {
  // Only honour an info URL override when data and trading share a network (e.g. a local mock).
  const override = cfg.network === cfg.dataNetwork ? apiBase(cfg.infoUrl) : undefined;
  return new HttpTransport({ isTestnet: cfg.network === "testnet", ...(override ? { apiUrl: override } : {}) });
}

export const userInfo = (t: HttpTransport) => new InfoClient({ transport: t });

/**
 * Agent client: signs L1 actions (orders, cancels, leverage, agentSendAsset). It cannot
 * withdraw or approve anything: those are user-signed actions.
 */
export function agentExchange(t: HttpTransport, agent: AbstractWallet) {
  return new ExchangeClient({ transport: t, wallet: agent });
}

/**
 * Master-wallet client for user-signed actions (approveAgent, approveBuilderFee, withdraw3,
 * sendAsset). `signatureChainId` is pinned to the chain the wallet is on (we switch it to
 * Arbitrum first) because wallets reject EIP-712 domains for another chain.
 */
export function masterExchange(t: HttpTransport, wallet: AbstractWallet, chainId: number) {
  return new ExchangeClient({ transport: t, wallet, signatureChainId: `0x${chainId.toString(16)}` });
}

export const agentNameWithExpiry = (now = Date.now()) => `${AGENT_NAME} valid_until ${now + AGENT_TTL_MS}`;

export const builderMaxFeeRate = (feeTenthsBps: number) => tenthsBpsToPercentString(feeTenthsBps);

export const hyperliquidChain = (n: HlNetwork) => (n === "mainnet" ? "Mainnet" : "Testnet");

export type { AbstractWallet };
