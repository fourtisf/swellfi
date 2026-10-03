"use client";

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fillAnalytics,
  parsePositions,
  summarizeAccount,
  tradingTransport,
  userInfo,
  type AccountPosition,
  type ClearinghouseLike,
} from "@swellfi/hl";
import { useEffect, useMemo } from "react";
import { api } from "../api";
import { HL } from "../env";
import { getSocket } from "../market";
import { useSession } from "../session";

export const hlTransport = tradingTransport(HL);
export const hlInfo = userInfo(hlTransport);

/** Every dex the account may hold collateral or positions on. */
export const DEXES = ["", ...HL.hip3Dexes];

/** Trading needs prices, asset ids and orders on the same network. */
export const TRADING_NETWORK_OK = HL.network === HL.dataNetwork;

const key = (...k: unknown[]) => ["hl", HL.network, ...k];

/** The signed-in user's master address, if registered. */
let lastSync = 0;
/**
 * Ask the server's indexer to poll this account now (best effort). Sent right away, never
 * deferred on the client: a timer would die if the page navigates. Only a burst of messages for
 * the same order within a second is collapsed; the server coalesces the rest without dropping.
 * `keepalive` lets the request finish even if the user leaves the page right after trading.
 */
export function syncIndexer() {
  if (Date.now() - lastSync < 1_000) return;
  lastSync = Date.now();
  void api("/me/sync", { method: "POST", keepalive: true }).catch(() => {});
}

export function useTraderAddress(): `0x${string}` | null {
  const s = useSession();
  return s.status === "ready" ? (s.me!.user.address as `0x${string}`) : null;
}

/**
 * Live Hyperliquid account for the master wallet: clearinghouse state on every dex, open
 * orders, agent + builder approvals. Polls, and refreshes immediately on WS order/fill events.
 */
export function useHlAccount() {
  const user = useTraderAddress();
  const qc = useQueryClient();
  const enabled = Boolean(user);

  const states = useQueries({
    queries: DEXES.map((dex) => ({
      queryKey: key("ch", user, dex),
      enabled,
      refetchInterval: 5_000,
      queryFn: () => hlInfo.clearinghouseState({ user: user!, dex }) as Promise<ClearinghouseLike>,
    })),
  });

  const orders = useQueries({
    queries: DEXES.map((dex) => ({
      queryKey: key("orders", user, dex),
      enabled,
      refetchInterval: 8_000,
      queryFn: () => hlInfo.frontendOpenOrders({ user: user!, dex }),
    })),
  });

  const agents = useQuery({ queryKey: key("agents", user), enabled, refetchInterval: 30_000, queryFn: () => hlInfo.extraAgents({ user: user! }) });
  const builderFee = useQuery({
    queryKey: key("builderFee", user),
    enabled: enabled && Boolean(HL.builder.address),
    refetchInterval: 30_000,
    queryFn: () => hlInfo.maxBuilderFee({ user: user!, builder: HL.builder.address as `0x${string}` }),
  });
  const abstraction = useQuery({ queryKey: key("abstraction", user), enabled, staleTime: 60_000, queryFn: () => hlInfo.userAbstraction({ user: user! }) });
  const unified = abstraction.data === "unifiedAccount" || abstraction.data === "portfolioMargin";
  const spot = useQuery({
    queryKey: key("spot", user),
    enabled: enabled && unified,
    refetchInterval: 5_000,
    queryFn: () => hlInfo.spotClearinghouseState({ user: user! }),
  });

  // Push updates: order/fill events invalidate the polled state right away.
  useEffect(() => {
    if (!user || !TRADING_NETWORK_OK) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        void qc.invalidateQueries({ queryKey: key("ch", user) });
        void qc.invalidateQueries({ queryKey: key("orders", user) });
        void qc.invalidateQueries({ queryKey: key("fills", user) });
      }, 400);
    };
    // New fills (Hyperliquid flags the history sent on subscribe as a snapshot): tell the indexer
    // so the feed picks the trade up now instead of on its next scheduled poll.
    const onFills = (msg: { data?: unknown }) => {
      bump();
      if (!(msg.data as { isSnapshot?: boolean } | undefined)?.isSnapshot) syncIndexer();
    };
    const s = getSocket();
    const off1 = s.subscribe({ type: "orderUpdates", user }, bump);
    const off2 = s.subscribe({ type: "userFills", user }, onFills);
    return () => {
      off1();
      off2();
      if (t) clearTimeout(t);
    };
  }, [user, qc]);

  const loaded = states.every((q) => q.isSuccess);
  const stateData = states.map((q) => q.data).filter(Boolean) as ClearinghouseLike[];
  const positions = useMemo<AccountPosition[]>(() => states.flatMap((q, i) => (q.data ? parsePositions(q.data as ClearinghouseLike, DEXES[i]) : [])), [states]);
  const summary = useMemo(() => {
    const s = summarizeAccount(stateData, positions);
    if (unified && spot.data) {
      const usdc = spot.data.balances.find((b) => b.coin === "USDC");
      const free = usdc ? +usdc.total - +usdc.hold : 0;
      return { ...s, withdrawable: free, accountValue: Math.max(s.accountValue, free + s.marginUsed + s.unrealizedPnl) };
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, unified, spot.data, ...stateData]);
  const withdrawableByDex = useMemo(() => Object.fromEntries(DEXES.map((d, i) => [d, +((states[i]?.data as ClearinghouseLike | undefined)?.withdrawable ?? 0)])), [states]);
  const openOrders = useMemo(() => orders.flatMap((q) => q.data ?? []).sort((a, b) => b.timestamp - a.timestamp), [orders]);

  const now = Date.now();
  const agent = (agents.data ?? []).find((a) => a.name.split(" ")[0] === "swellfi" && (a.validUntil == null || a.validUntil > now)) ?? null;
  const builderApproved = HL.builder.address ? (builderFee.data ?? 0) >= HL.builder.feeTenthsBps : false;

  return {
    user,
    loaded,
    summary,
    positions,
    openOrders,
    withdrawableByDex,
    unified,
    agentOnChain: agent,
    builderApproved,
    approvalsLoaded: agents.isSuccess && (builderFee.isSuccess || !HL.builder.address),
    funded: summary.accountValue > 0 || summary.withdrawable > 0,
    refresh: () => qc.invalidateQueries({ queryKey: key() }),
  };
}

export type HlAccount = ReturnType<typeof useHlAccount>;

export function useFills(enabled = true) {
  const user = useTraderAddress();
  const q = useQuery({ queryKey: key("fills", user), enabled: enabled && Boolean(user), refetchInterval: 15_000, queryFn: () => hlInfo.userFills({ user: user! }) });
  const analytics = useMemo(() => fillAnalytics(q.data ?? []), [q.data]);
  return { fills: q.data ?? [], analytics, isLoading: q.isLoading };
}

export function useOrderHistory(enabled: boolean) {
  const user = useTraderAddress();
  return useQuery({ queryKey: key("history", user), enabled: enabled && Boolean(user), refetchInterval: 20_000, queryFn: () => hlInfo.historicalOrders({ user: user! }) });
}

export function useFundingHistory(enabled: boolean) {
  const user = useTraderAddress();
  return useQuery({
    queryKey: key("funding", user),
    enabled: enabled && Boolean(user),
    refetchInterval: 60_000,
    queryFn: () => hlInfo.userFunding({ user: user!, startTime: Date.now() - 30 * 864e5 }),
  });
}

export const hlQueryKey = key;
