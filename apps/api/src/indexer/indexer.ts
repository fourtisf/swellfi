import { Prisma, type PrismaClient } from "@swellfi/db";
import type { Redis } from "ioredis";
import { CH, publish } from "../ws/gateway";
import { buildEvents, equityByDay, fillId, rollupDays, utcDay, type FeedEvent, type HlFill } from "./events";

/**
 * Indexer: for every registered user, pull new Hyperliquid fills, store them, turn them into
 * feed events (one per order: "opened"/"closed") and roll them up into DailyStat (PnL, volume,
 * equity). Polling is adaptive (busy traders every ~20 s, quiet ones back off to 15 min) and
 * globally rate limited, since all info requests share one IP budget at Hyperliquid.
 */

export interface IndexerInfo {
  userFillsByTime(user: string, startTime: number): Promise<HlFill[]>;
  /** Per dex: account value and current leverage per coin. */
  account(user: string, dex: string): Promise<{ accountValue: number; lev: Record<string, number> }>;
  /** Account value history (ms, value) for the last month, or [] if unavailable. */
  monthEquity(user: string): Promise<[number, string][]>;
}

/** Info requests over Hyperliquid's /info endpoint (via @swellfi/hl's retrying client). */
export function hlIndexerInfo(post: <T>(body: Record<string, unknown>) => Promise<T>): IndexerInfo {
  type Ch = { marginSummary?: { accountValue?: string }; assetPositions?: { position: { coin: string; leverage?: { value?: number } } }[] };
  return {
    userFillsByTime: (user, startTime) => post<HlFill[]>({ type: "userFillsByTime", user, startTime, aggregateByTime: false }),
    async account(user, dex) {
      const r = await post<Ch>(dex ? { type: "clearinghouseState", user, dex } : { type: "clearinghouseState", user });
      const lev: Record<string, number> = {};
      for (const p of r.assetPositions ?? []) if (p.position?.leverage?.value) lev[p.position.coin] = p.position.leverage.value;
      return { accountValue: Number(r.marginSummary?.accountValue ?? 0) || 0, lev };
    },
    async monthEquity(user) {
      const r = await post<[string, { accountValueHistory?: [number, string][] }][]>({ type: "portfolio", user });
      const pick = (name: string) => r.find(([k]) => k === name)?.[1]?.accountValueHistory;
      return pick("perpMonth") ?? pick("month") ?? [];
    },
  };
}

export interface IndexerOptions {
  prisma: PrismaClient;
  redis: Redis;
  info: IndexerInfo;
  /** HIP-3 dexes whose accounts count toward equity (the main dex "" is always included). */
  dexes?: string[];
  /** Max info requests per minute. */
  rpm?: number;
  now?: () => number;
  log?: (msg: string, extra?: unknown) => void;
  /** Log every poll (INDEXER_DEBUG=1). */
  debug?: boolean;
}

export const BACKFILL_DAYS = 30;
/** Older fills only feed the stats; the feed shows the last week. */
export const FEED_BACKFILL_DAYS = 7;
const BUSY_MS = 20_000;
const MAX_IDLE_MS = 15 * 60_000;
const EQUITY_EVERY_MS = 15 * 60_000;
const PAGE = 2000; // userFillsByTime returns at most 2000 fills per call

const D = (v: number) => new Prisma.Decimal(v.toFixed(10));
// Next poll after `idle` quiet polls in a row. A sync resets the count, so a fresh trade is
// rechecked within seconds (Hyperliquid's info API can trail the exchange by a moment).
const STEPS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, MAX_IDLE_MS];
export const backoffMs = (idle: number) => STEPS[Math.min(Math.max(idle, 1), STEPS.length) - 1]!;

export function createIndexer(o: IndexerOptions) {
  const { prisma, redis, info } = o;
  const now = o.now ?? Date.now;
  const log = o.log ?? ((m: string, e?: unknown) => console.log(`${new Date().toISOString()} [indexer] ${m}`, e ?? ""));
  const dexes = ["", ...(o.dexes ?? [])];
  const debug = o.debug ?? false;

  // Token bucket shared by every request this process makes.
  const rpm = o.rpm ?? 40;
  let tokens = rpm;
  let refilled = now();
  let pausedUntil = 0;
  async function take() {
    for (;;) {
      const t = now();
      tokens = Math.min(rpm, tokens + ((t - refilled) / 60_000) * rpm);
      refilled = t;
      if (t >= pausedUntil && tokens >= 1) {
        tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, Math.max(50, pausedUntil - t, ((1 - tokens) / rpm) * 60_000)));
    }
  }
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    await take();
    try {
      return await fn();
    } catch (e) {
      // Too many requests: everyone waits a minute.
      if ((e as { status?: number }).status === 429) pausedUntil = now() + 60_000;
      throw e;
    }
  }

  /** Every new fill since the cursor, following pages of 2000. */
  async function newFills(address: string, cursor: number): Promise<HlFill[]> {
    const out: HlFill[] = [];
    let start = cursor ? cursor + 1 : now() - BACKFILL_DAYS * 864e5;
    for (let i = 0; i < 10; i++) {
      const page = await call(() => info.userFillsByTime(address, start));
      out.push(...page);
      if (page.length < PAGE) break;
      start = Math.max(...page.map((f) => f.time)); // same-ms fills are deduplicated by id
    }
    return out;
  }

  async function saveFills(userId: string, fills: HlFill[]) {
    if (!fills.length) return 0;
    const r = await prisma.fill.createMany({
      data: fills.map((f) => ({
        id: fillId(f),
        hash: f.hash,
        userId,
        coin: f.coin,
        side: f.side,
        px: new Prisma.Decimal(f.px),
        sz: new Prisma.Decimal(f.sz),
        fee: new Prisma.Decimal(f.fee),
        builderFee: f.builderFee ? new Prisma.Decimal(f.builderFee) : null,
        closedPnl: new Prisma.Decimal(f.closedPnl),
        dir: f.dir,
        oid: BigInt(f.oid),
        startPos: new Prisma.Decimal(f.startPosition || "0"),
        time: new Date(f.time),
      })),
      skipDuplicates: true,
    });
    return r.count;
  }

  const asHl = (r: { id: string; hash: string; coin: string; side: string; px: Prisma.Decimal; sz: Prisma.Decimal; fee: Prisma.Decimal; closedPnl: Prisma.Decimal; dir: string; oid: bigint | null; startPos: Prisma.Decimal | null; time: Date }): HlFill => ({
    coin: r.coin,
    px: r.px.toString(),
    sz: r.sz.toString(),
    side: r.side as "B" | "A",
    time: r.time.getTime(),
    startPosition: r.startPos?.toString() ?? "0",
    dir: r.dir,
    closedPnl: r.closedPnl.toString(),
    hash: r.hash,
    oid: Number(r.oid ?? 0),
    fee: r.fee.toString(),
    tid: Number(r.id.split(":")[1] ?? 0),
  });

  /** Rebuild the feed events of these orders from every stored fill (partial fills converge). */
  async function upsertEvents(userId: string, newOnes: HlFill[], lev: Record<string, number>) {
    const feedFrom = now() - FEED_BACKFILL_DAYS * 864e5;
    const oids = [...new Set(newOnes.filter((f) => f.time >= feedFrom).map((f) => f.oid))];
    if (!oids.length) return [];
    const stored = await prisma.fill.findMany({ where: { userId, oid: { in: oids.map((x) => BigInt(x)) } } });
    const all = stored.map(asHl);
    const events = buildEvents(userId, all, lev);
    const existing = new Map((await prisma.activity.findMany({ where: { id: { in: events.map((e) => e.id) } }, select: { id: true, data: true } })).map((a) => [a.id, a.data as FeedEvent["data"]]));
    const created: FeedEvent[] = [];
    for (const e of events) {
      const prev = existing.get(e.id);
      // Keep the leverage seen at open time; a close may happen after the position is gone.
      const data = { ...e.data, ...(e.data.lev == null && prev?.lev != null ? { lev: prev.lev } : {}) };
      if (e.kind === "close" && data.lev == null) {
        const open = await prisma.activity.findFirst({
          where: { userId, kind: "open", createdAt: { lte: e.createdAt }, data: { path: ["coin"], equals: e.data.coin } },
          orderBy: { createdAt: "desc" },
          select: { data: true },
        });
        const od = open?.data as FeedEvent["data"] | undefined;
        if (od?.lev) data.lev = od.lev;
      }
      if (prev) await prisma.activity.update({ where: { id: e.id }, data: { data } });
      else {
        await prisma.activity.create({ data: { id: e.id, userId, kind: e.kind, data, createdAt: e.createdAt } });
        created.push({ ...e, data });
      }
    }
    return created;
  }

  /** Recompute DailyStat for the days these fills touch, keeping the stored equity. */
  async function rollup(userId: string, fills: HlFill[]) {
    const days = [...new Set(fills.map((f) => utcDay(f.time).getTime()))];
    for (const day of days) {
      const from = new Date(day), to = new Date(day + 864e5);
      const rows = await prisma.fill.findMany({ where: { userId, time: { gte: from, lt: to } } });
      const [s] = rollupDays(rows.map(asHl));
      const stat = s ?? { pnl: 0, volume: 0, trades: 0, closedTrades: 0, wins: 0 };
      const prevEq = await prisma.dailyStat.findFirst({ where: { userId, date: { lt: from } }, orderBy: { date: "desc" }, select: { equity: true } });
      const vals = { pnl: D(stat.pnl), volume: D(stat.volume), trades: stat.trades, closedTrades: stat.closedTrades, wins: stat.wins };
      await prisma.dailyStat.upsert({
        where: { userId_date: { userId, date: from } },
        create: { userId, date: from, ...vals, equity: prevEq?.equity ?? D(0) },
        update: vals,
      });
    }
  }

  async function setEquity(userId: string, day: number, equity: number) {
    const date = new Date(day);
    await prisma.dailyStat.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, pnl: D(0), volume: D(0), equity: D(equity), trades: 0 },
      update: { equity: D(equity) },
    });
  }

  /** Index one user. Returns the number of new fills. */
  async function pollUser(user: { id: string; address: string }) {
    const st = await prisma.indexState.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    const fills = await newFills(user.address, Number(st.fillCursor));
    const added = await saveFills(user.id, fills);
    const t = now();
    let lev: Record<string, number> = {};
    let equity: number | null = null;
    if (fills.length || !st.equityAt || t - st.equityAt.getTime() > EQUITY_EVERY_MS) {
      equity = 0;
      for (const dex of dexes) {
        const a = await call(() => info.account(user.address, dex));
        equity += a.accountValue;
        lev = { ...lev, ...a.lev };
      }
    }
    // Equity history once, so ROI and the equity chart work from the first day.
    if (!st.backfilled) {
      const hist = await call(() => info.monthEquity(user.address)).catch(() => []);
      for (const [day, v] of equityByDay(hist)) await setEquity(user.id, day, v);
    }
    let created: FeedEvent[] = [];
    if (fills.length) {
      await rollup(user.id, fills);
      created = await upsertEvents(user.id, fills, lev);
    }
    if (equity != null) await setEquity(user.id, utcDay(t).getTime(), equity);

    const cursor = fills.length ? Math.max(Number(st.fillCursor), ...fills.map((f) => f.time)) : Number(st.fillCursor);
    const idle = added ? 0 : st.idleStreak + 1;
    await prisma.indexState.update({
      where: { userId: user.id },
      data: { fillCursor: BigInt(cursor), backfilled: true, ...(equity != null ? { equityAt: new Date(t) } : {}), idleStreak: idle, lastError: null },
    });
    // Schedule the next poll, unless a sync (/me/sync) asked for an earlier one while this poll
    // ran: that request must win, or a trade made during the poll would wait for the backoff.
    // One statement, so a sync landing right now can't be lost either.
    const next = new Date(t + (added ? BUSY_MS : backoffMs(idle)));
    await prisma.$executeRaw`UPDATE "IndexState" SET "nextPollAt" = CASE WHEN "nextPollAt" <> ${st.nextPollAt} THEN LEAST("nextPollAt", ${next}) ELSE ${next} END WHERE "userId" = ${user.id}`;
    // Live feed: only events that just happened (not a backfill).
    for (const e of created) {
      if (t - e.createdAt.getTime() < 15 * 60_000) await publish(redis, CH.activity, { id: e.id, kind: e.kind, userId: user.id, data: e.data, createdAt: e.createdAt }).catch(() => {});
    }
    if (created.length || added) await redis.del("tl:act:sum", "tl:lb:24h", "tl:lb:7d", "tl:lb:30d", "tl:lb:all").catch(() => {});
    return added;
  }

  /** Make sure every real (non-demo) user has an IndexState row. */
  async function enroll() {
    const missing = await prisma.user.findMany({ where: { isDemo: false, indexState: null }, select: { id: true }, take: 500 });
    if (missing.length) await prisma.indexState.createMany({ data: missing.map((u) => ({ userId: u.id })), skipDuplicates: true });
    return missing.length;
  }

  /** Poll every user that is due (at most `limit`). */
  async function tick(limit = 25) {
    await enroll();
    const due = await prisma.indexState.findMany({
      where: { nextPollAt: { lte: new Date(now()) }, user: { isDemo: false } },
      orderBy: { nextPollAt: "asc" },
      take: limit,
      include: { user: { select: { id: true, address: true } } },
    });
    let fills = 0;
    for (const s of due) {
      try {
        const t0 = now();
        const n = await pollUser(s.user);
        if (debug) log(`polled ${s.user.address} (due ${s.nextPollAt.toISOString()}): ${n} new fills, ${now() - t0} ms`);
        fills += n;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`user ${s.userId} failed: ${msg}`);
        await prisma.indexState.update({ where: { userId: s.userId }, data: { lastError: msg.slice(0, 500), nextPollAt: new Date(now() + 5 * 60_000) } }).catch(() => {});
      }
    }
    return { polled: due.length, fills };
  }

  let stopped = false;
  async function run() {
    log(`started (${rpm} requests/min, dexes: ${dexes.map((d) => d || "main").join(", ")})`);
    while (!stopped) {
      const r = await tick().catch((e) => (log("tick failed", e), { polled: 0, fills: 0 }));
      if (r.fills) log(`polled ${r.polled} users, ${r.fills} new fills`);
      if (!r.polled) await new Promise((res) => setTimeout(res, 2000));
    }
  }

  return { pollUser, tick, enroll, run, stop: () => void (stopped = true) };
}
