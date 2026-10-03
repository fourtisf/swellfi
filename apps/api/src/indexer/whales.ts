import type { PrismaClient } from "@swellfi/db";
import type { Redis } from "ioredis";
import { CH, publish } from "../ws/gateway";
import { externalUser } from "./external";

/**
 * Whale trades: large taker orders on Hyperliquid, from the public `trades` WebSocket feed.
 * One taker order that sweeps several price levels arrives as several trades with the same
 * hash; they're summed into one event per order.
 */

export interface HlTrade {
  coin: string;
  side: "B" | "A"; // the taker's side
  px: string;
  sz: string;
  time: number;
  hash: string;
  tid: number;
  users?: [string, string]; // [buyer, seller]
}

export interface Whale {
  id: string;
  coin: string;
  taker: string;
  side: "buy" | "sell";
  size: number; // USD
  sz: number;
  px: number; // average price
  time: number;
}

const ZERO_HASH = /^0x0*$/;

/** Sums the trades of each taker order; an order is done once no trade for it came in `quietMs`. */
export function createWhaleAggregator(o: { minUsd: (coin: string) => number; quietMs?: number; maxAgeMs?: number; onWhale: (w: Whale) => void }) {
  const quiet = o.quietMs ?? 2000;
  const maxAge = o.maxAgeMs ?? 60_000;
  const open = new Map<string, Whale & { last: number }>();
  const seen = new Set<number>();

  function add(t: HlTrade, now: number) {
    if (!t?.users || t.users.length !== 2 || seen.has(t.tid)) return;
    // Snapshots on (re)subscribe replay recent trades: anything old was handled or missed.
    if (now - t.time > maxAge) return;
    seen.add(t.tid);
    if (seen.size > 200_000) seen.clear();
    const taker = (t.side === "B" ? t.users[0] : t.users[1]).toLowerCase();
    const px = Number(t.px), sz = Number(t.sz);
    if (!(px > 0 && sz > 0)) return;
    // Some fills (TWAP slices) carry no hash: group those by taker and second.
    const order = ZERO_HASH.test(t.hash ?? "") ? `t${Math.floor(t.time / 1000)}` : t.hash;
    const key = `${t.coin}:${taker}:${order}`;
    const w = open.get(key);
    if (w) {
      w.sz += sz;
      w.size += px * sz;
      w.px = w.size / w.sz;
      w.last = now;
    } else {
      open.set(key, { id: `whale:${key}`, coin: t.coin, taker, side: t.side === "B" ? "buy" : "sell", size: px * sz, sz, px, time: t.time, last: now });
    }
  }

  function flush(now: number, all = false) {
    for (const [key, w] of open) {
      if (!all && now - w.last < quiet) continue;
      open.delete(key);
      if (w.size >= o.minUsd(w.coin)) {
        const { last: _, ...whale } = w;
        o.onWhale(whale);
      }
    }
  }

  return { add, flush, pending: () => open.size };
}

/** Store a whale trade as a feed event, unless the taker's own trades are already indexed. */
export async function saveWhale(prisma: PrismaClient, redis: Redis, w: Whale) {
  const user = await externalUser(prisma, w.taker, "external");
  // Members and followed top traders get their own open/close events from the indexer.
  if (user.kind !== "external") return false;
  const data = { coin: w.coin, side: w.side, size: Math.round(w.size), sz: +w.sz.toPrecision(8), px: +w.px.toPrecision(8) };
  const r = await prisma.activity.createMany({ data: [{ id: w.id, userId: user.id, kind: "whale", data, createdAt: new Date(w.time) }], skipDuplicates: true });
  if (r.count) await publish(redis, CH.activity, { id: w.id, kind: "whale", userId: user.id, data, createdAt: new Date(w.time) }).catch(() => {});
  return r.count > 0;
}

export interface WhaleWatcherOptions {
  url: string;
  /** Markets to watch (refreshed every hour). */
  coins: () => Promise<string[]>;
  minUsd: (coin: string) => number;
  onWhale: (w: Whale) => Promise<unknown>;
  log: (msg: string) => void;
}

/** Keeps a WebSocket to Hyperliquid open (reconnecting with backoff) and feeds the aggregator. */
export function startWhaleWatcher(o: WhaleWatcherOptions) {
  let ws: WebSocket | null = null;
  let stopped = false;
  let coins: string[] = [];
  let retry = 1000;
  const agg = createWhaleAggregator({
    minUsd: o.minUsd,
    onWhale: (w) => void o.onWhale(w).catch((e) => o.log(`whale save failed: ${e instanceof Error ? e.message : e}`)),
  });
  const flushTimer = setInterval(() => agg.flush(Date.now()), 1000);
  const send = (m: unknown) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const pingTimer = setInterval(() => send({ method: "ping" }), 30_000);

  async function refreshCoins() {
    try {
      const next = await o.coins();
      if (!next.length) return;
      for (const c of coins) if (!next.includes(c)) send({ method: "unsubscribe", subscription: { type: "trades", coin: c } });
      for (const c of next) if (!coins.includes(c)) send({ method: "subscribe", subscription: { type: "trades", coin: c } });
      coins = next;
    } catch (e) {
      o.log(`whale markets refresh failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const coinTimer = setInterval(() => void refreshCoins(), 3600_000);

  function connect() {
    if (stopped) return;
    const sock = new WebSocket(o.url);
    ws = sock;
    sock.onopen = async () => {
      retry = 1000;
      if (!coins.length) await refreshCoins();
      else for (const c of coins) send({ method: "subscribe", subscription: { type: "trades", coin: c } });
      o.log(`whale watcher: ${coins.length} markets`);
    };
    sock.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as { channel?: string; data?: HlTrade[] };
        if (m.channel !== "trades" || !Array.isArray(m.data)) return;
        const now = Date.now();
        for (const t of m.data) agg.add(t, now);
      } catch {
        /* not ours */
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (stopped) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 60_000);
    };
    sock.onerror = () => sock.close();
  }
  connect();

  return {
    stop() {
      stopped = true;
      clearInterval(flushTimer);
      clearInterval(pingTimer);
      clearInterval(coinTimer);
      agg.flush(Date.now(), true);
      ws?.close();
    },
  };
}
