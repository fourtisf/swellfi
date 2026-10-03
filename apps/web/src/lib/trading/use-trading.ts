"use client";

import {
  agentExchange,
  agentNameWithExpiry,
  AGENT_TTL_MS,
  BRIDGE,
  buildClose,
  buildOrder,
  buildPositionTpsl,
  builderMaxFeeRate,
  ERC20_ABI,
  masterExchange,
  MIN_DEPOSIT_USDC,
  summarizeStatuses,
  toUsdcUnits,
  type AbstractWallet,
  type AccountPosition,
  type Market,
  type OrderIntent,
} from "@swellfi/hl";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { createPublicClient, http, type PrivateKeyAccount } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { HL } from "../env";
import { useMarkets } from "../market";
import { useSession } from "../session";
import { createAgent, loadAgent } from "./agent-store";
import { hlInfo, hlQueryKey, hlTransport, syncIndexer, TRADING_NETWORK_OK, useBuilderRefused, type HlAccount } from "./account";

export const ARB = BRIDGE[HL.network];
export const arbPublic = createPublicClient({
  chain: HL.network === "mainnet" ? arbitrum : arbitrumSepolia,
  transport: http(process.env.NEXT_PUBLIC_ARB_RPC_URL || ARB.rpcUrl),
});

/** Human message from SDK / wallet errors. */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return "Signature request was cancelled";
  // Hyperliquid only approves a builder that holds 100+ USDC in perps: a platform setup issue, not the user's.
  if (/builder has insufficient balance/i.test(m)) return "Swellfi's fee wallet isn't active on Hyperliquid yet. Nothing was charged; please try again later.";
  return m.replace(/^.*?Error: /, "").slice(0, 200);
}

/** Orders carry the builder fee only when it's approved (not from the builder wallet itself, nor while the builder can't be approved). */
function feeFor<T extends { builder?: unknown }>(params: T, feeOn: boolean): T {
  if (feeOn) return params;
  const { builder: _, ...rest } = params;
  return rest as T;
}

const leverageSynced = new Map<string, string>();
const collateralTokens = new Map<string, string>();

/** "USDC:0x…" collateral token string for a HIP-3 dex (meta.collateralToken → spotMeta token). */
async function collateralToken(dex: string): Promise<string> {
  const hit = collateralTokens.get(dex);
  if (hit) return hit;
  const [meta, spot] = await Promise.all([hlInfo.meta({ dex }), hlInfo.spotMeta()]);
  const idx = (meta as { collateralToken?: number }).collateralToken ?? 0;
  const tok = spot.tokens.find((t) => t.index === idx);
  if (!tok) throw new Error(`Unknown collateral token for ${dex}`);
  const s = `${tok.name}:${tok.tokenId}`;
  collateralTokens.set(dex, s);
  return s;
}

/**
 * Trading actions. Orders, cancels, leverage and dex transfers are signed by the agent key
 * stored in this browser. Deposits, approvals and withdrawals are signed by the master wallet.
 */
export function useTrading(acct: HlAccount) {
  const s = useSession();
  const qc = useQueryClient();
  const user = acct.user;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: hlQueryKey() }), [qc]);

  const master = useCallback(async () => {
    const wallet = await s.getMasterWallet(ARB.chainId);
    // A viem WalletClient is the SDK's "JSON-RPC account" shape (signTypedData/getAddresses/getChainId).
    return { wallet, ex: masterExchange(hlTransport, wallet as unknown as AbstractWallet, ARB.chainId) };
  }, [s]);

  /** The local agent, if it is the one currently approved on Hyperliquid. */
  const getAgent = useCallback(async (): Promise<PrivateKeyAccount | null> => {
    if (!user || !acct.agentOnChain) return null;
    const local = await loadAgent(HL.network, user);
    return local && local.account.address.toLowerCase() === acct.agentOnChain.address.toLowerCase() ? local.account : null;
  }, [user, acct.agentOnChain]);

  const requireAgent = useCallback(async () => {
    if (!TRADING_NETWORK_OK) throw new Error("Market data and trading must use the same network");
    const a = await getAgent();
    if (!a) throw new Error("Enable trading first");
    return agentExchange(hlTransport, a);
  }, [getAgent]);

  /** Steps 2 + 3 of onboarding: approve a fresh agent, then the builder fee. Two wallet signatures. */
  const enableTrading = useCallback(async () => {
    if (!user) throw new Error("Sign in first");
    if (!HL.builder.address) throw new Error("The platform builder address isn't configured");
    const { ex } = await master();
    if (!(await getAgent())) {
      const validUntil = Date.now() + AGENT_TTL_MS;
      const agent = await createAgent(HL.network, user, validUntil);
      await ex.approveAgent({ agentAddress: agent.address, agentName: agentNameWithExpiry(validUntil - AGENT_TTL_MS) });
    }
    if (!acct.builderApproved) {
      try {
        await ex.approveBuilderFee({ builder: HL.builder.address as `0x${string}`, maxFeeRate: builderMaxFeeRate(HL.builder.feeTenthsBps) });
      } catch (e) {
        // The builder isn't funded yet: trading still opens, without the platform fee.
        if (!/builder has insufficient balance/i.test(e instanceof Error ? e.message : String(e))) throw e;
        useBuilderRefused.setState({ refused: true });
      }
    }
    await refresh();
  }, [user, master, getAgent, acct.builderApproved, refresh]);

  /** USDC on Arbitrum → Bridge2. Resolves once the transfer is mined; credit is polled by the caller. */
  const deposit = useCallback(
    async (amount: string, onTx?: (hash: string) => void) => {
      // Bridge2 keeps anything under the minimum: never send it, whatever the caller checked.
      const units = toUsdcUnits(amount);
      if (units < BigInt(MIN_DEPOSIT_USDC) * 1_000_000n) throw new Error(`Minimum deposit is ${MIN_DEPOSIT_USDC} USDC`);
      const { wallet } = await master();
      const hash = await wallet.writeContract({
        account: wallet.account!,
        chain: wallet.chain,
        address: ARB.usdc,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [ARB.bridge, units],
      });
      onTx?.(hash);
      const receipt = await arbPublic.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Deposit transaction failed");
      return hash;
    },
    [master],
  );

  const withdraw = useCallback(
    async (amount: string) => {
      if (!user) throw new Error("Sign in first");
      const { wallet, ex } = await master();
      // Pay out to the signing wallet itself, never to an address taken from a server response.
      const signer = wallet.account?.address;
      if (!signer || signer.toLowerCase() !== user.toLowerCase()) throw new Error("Your wallet doesn't match this account. Log in again.");
      await ex.withdraw3({ destination: signer, amount });
      await refresh();
    },
    [user, master, refresh],
  );

  /** Make sure the asset's leverage/margin mode on Hyperliquid matches the order panel. */
  const syncLeverage = useCallback(
    async (m: Market, leverage: number, cross: boolean) => {
      const want = `${leverage}:${cross && !m.onlyIsolated}`;
      const k = `${user}:${m.name}`;
      if (leverageSynced.get(k) === want) return;
      const ex = await requireAgent();
      await ex.updateLeverage({ asset: m.assetId, isCross: cross && !m.onlyIsolated, leverage });
      leverageSynced.set(k, want);
    },
    [user, requireAgent],
  );

  /** HIP-3 dexes have their own collateral balance; top it up from the main dex if needed. */
  const ensureDexCollateral = useCallback(
    async (m: Market, margin: number) => {
      if (!m.dex || acct.unified || !user) return;
      const have = acct.withdrawableByDex[m.dex] ?? 0;
      const need = margin * 1.02 + 0.5 - have;
      if (need <= 0) return;
      if ((acct.withdrawableByDex[""] ?? 0) < need) throw new Error(`Not enough USDC to fund the ${m.dex} market`);
      const ex = await requireAgent();
      await ex.agentSendAsset({ destination: user, sourceDex: "", destinationDex: m.dex, token: await collateralToken(m.dex), amount: need.toFixed(2), fromSubAccount: "" });
    },
    [acct.unified, acct.withdrawableByDex, user, requireAgent],
  );

  const placeOrder = useCallback(
    async (m: Market, intent: Omit<OrderIntent, "market" | "builder">, opts: { leverage: number; cross: boolean; margin: number }) => {
      const params = feeFor(buildOrder({ ...intent, market: m, builder: HL.builder }), acct.builderFeeOn);
      await syncLeverage(m, opts.leverage, opts.cross);
      if (!intent.reduceOnly) await ensureDexCollateral(m, opts.margin);
      const ex = await requireAgent();
      const res = await ex.order(params);
      void refresh();
      // Feed: don't wait for the fill to come back over the WebSocket (the user may leave the page).
      syncIndexer();
      return summarizeStatuses(res.response.data.statuses);
    },
    [syncLeverage, ensureDexCollateral, requireAgent, refresh, acct.builderFeeOn],
  );

  const cancel = useCallback(
    async (coin: string, oid: number) => {
      const m = useMarkets.getState().byName[coin];
      if (!m) throw new Error(`Unknown market ${coin}`);
      const ex = await requireAgent();
      await ex.cancel({ cancels: [{ a: m.assetId, o: oid }] });
      void refresh();
    },
    [requireAgent, refresh],
  );

  const closePosition = useCallback(
    async (p: AccountPosition, fraction = 1, limitPx?: number, size?: number) => {
      const st = useMarkets.getState();
      const m = st.byName[p.coin];
      const mid = st.mids[p.coin];
      if (!m || !mid) throw new Error(`No price for ${p.coin}`);
      const ex = await requireAgent();
      const res = await ex.order(feeFor(buildClose({ market: m, szi: p.szi, mid, fraction, size, limitPx, builder: HL.builder }), acct.builderFeeOn));
      void refresh();
      syncIndexer();
      return summarizeStatuses(res.response.data.statuses);
    },
    [requireAgent, refresh, acct.builderFeeOn],
  );

  /**
   * Position TP/SL: places the new triggers first, then cancels the ones they replace, so a
   * failed placement never leaves the position unprotected.
   */
  const setPositionTpsl = useCallback(
    async (p: AccountPosition, place: { tp?: number; sl?: number }, cancelOids: number[]) => {
      const m = useMarkets.getState().byName[p.coin];
      if (!m) throw new Error(`Unknown market ${p.coin}`);
      const ex = await requireAgent();
      if (place.tp || place.sl) {
        const res = await ex.order(feeFor(buildPositionTpsl({ market: m, szi: p.szi, tp: place.tp, sl: place.sl, builder: HL.builder }), acct.builderFeeOn));
        summarizeStatuses(res.response.data.statuses);
      }
      try {
        if (cancelOids.length) await ex.cancel({ cancels: cancelOids.map((o) => ({ a: m.assetId, o })) });
      } catch (e) {
        if (place.tp || place.sl) throw new Error(`The new TP/SL is set, but the old one couldn't be cancelled: ${errMsg(e)}. Cancel it under Open Orders.`);
        throw e;
      } finally {
        void refresh();
      }
    },
    [requireAgent, refresh, acct.builderFeeOn],
  );

  return { enableTrading, deposit, withdraw, placeOrder, cancel, closePosition, setPositionTpsl, getAgent };
}

export async function creditedBalance(user: `0x${string}`) {
  const [perp, spot] = await Promise.all([hlInfo.clearinghouseState({ user }), hlInfo.spotClearinghouseState({ user }).catch(() => null)]);
  const usdc = spot?.balances.find((b) => b.coin === "USDC");
  // Unified-account users are credited in the spot balance, others in perps.
  return +perp.marginSummary.accountValue + (usdc ? +usdc.total : 0);
}

/** Poll until the bridge credits the deposit (balance grows), or time out. */
export async function waitForCredit(user: `0x${string}`, before: number, timeoutMs = 180_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      if ((await creditedBalance(user)) > before + 0.01) return true;
    } catch {
      /* keep polling */
    }
  }
  return false;
}

export async function usdcBalance(addr: `0x${string}`): Promise<bigint> {
  return arbPublic.readContract({ address: ARB.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] });
}
