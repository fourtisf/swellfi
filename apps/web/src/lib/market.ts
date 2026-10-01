"use client";

import { createInfoClient, HlSocket, loadMarkets, type Market, type WsStatus } from "@swellfi/hl";
import { create } from "zustand";
import { HL } from "./env";

interface MarketState {
  status: "loading" | "live" | "error";
  ws: WsStatus;
  markets: Market[];
  byName: Record<string, Market>;
  /** Live mid prices, merged across dexes ("BTC", "xyz:NVDA"). */
  mids: Record<string, number>;
  /** 24h hourly closes for sparklines. */
  spark: Record<string, number[]>;
}

export const useMarkets = create<MarketState>(() => ({
  status: "loading",
  ws: "idle",
  markets: [],
  byName: {},
  mids: {},
  spark: {},
}));

export const info = createInfoClient({ url: HL.infoUrl });

let socket: HlSocket | null = null;
export function getSocket(): HlSocket {
  if (!socket) {
    socket = new HlSocket({ url: HL.wsUrl });
    socket.onStatus((ws) => useMarkets.setState({ ws }));
    socket.start();
  }
  return socket;
}

let booted = false;
let pendingMids: Record<string, number> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Mids arrive many times a second; repaint at most ~once a second (prototype scheduleTick). */
function queueMids(d: Record<string, string>) {
  for (const k in d) pendingMids[k] = +d[k]!;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = pendingMids;
    pendingMids = {};
    useMarkets.setState((s) => ({ mids: { ...s.mids, ...batch } }));
  }, 900);
}

async function refreshMarkets() {
  try {
    const list = await loadMarkets(info, HL.hip3Dexes);
    const byName: Record<string, Market> = {};
    for (const m of list) byName[m.name] = m;
    useMarkets.setState((s) => {
      const mids = { ...s.mids };
      for (const m of list) if (mids[m.name] == null) mids[m.name] = m.px;
      return { markets: list, byName, mids, status: "live" };
    });
  } catch {
    if (!useMarkets.getState().markets.length) useMarkets.setState({ status: "error" });
  }
}

/** Load the market universe once, stream mids, and refresh 24h stats every minute. */
export function bootMarkets() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  void refreshMarkets();
  setInterval(refreshMarkets, 60_000);
  const s = getSocket();
  s.subscribe({ type: "allMids" }, (m) => queueMids(m.data.mids));
  for (const dex of HL.hip3Dexes) s.subscribe({ type: "allMids", dex }, (m) => queueMids(m.data.mids));
}

const sparkLoading = new Set<string>();
export async function loadSparks(names: string[]) {
  const end = Date.now();
  await Promise.all(
    names.map(async (n) => {
      if (useMarkets.getState().spark[n] || sparkLoading.has(n)) return;
      sparkLoading.add(n);
      try {
        const c = await info.candleSnapshot(n, "1h", end - 864e5, end);
        useMarkets.setState((s) => ({ spark: { ...s.spark, [n]: c.map((k) => k.c) } }));
      } catch {
        /* sparkline stays empty */
      } finally {
        sparkLoading.delete(n);
      }
    }),
  );
}

export const useMid = (coin: string) => useMarkets((s) => s.mids[coin]);
export const useMarket = (coin: string) => useMarkets((s) => s.byName[coin]);
