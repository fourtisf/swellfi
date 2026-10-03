import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupExternal, externalUser, pickTopTraders, setTopTraders, type LeaderboardRow } from "../src/indexer/external";
import type { HlFill } from "../src/indexer/events";
import { createIndexer, TOP, type IndexerInfo } from "../src/indexer/indexer";
import { createWhaleAggregator, saveWhale, type HlTrade, type Whale } from "../src/indexer/whales";
import { bearer, setupTestApp } from "./helpers";

const A = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const row = (n: number, month: { pnl: number; vlm: number }, value = 100_000, allTime = 1): LeaderboardRow => ({
  ethAddress: A(n).replace("0x", "0X"), // checked case-insensitively
  accountValue: String(value),
  windowPerformances: [
    ["day", { pnl: "1", roi: "0", vlm: "1" }],
    ["month", { pnl: String(month.pnl), roi: "0.1", vlm: String(month.vlm) }],
    ["allTime", { pnl: String(allTime), roi: "0.1", vlm: "1" }],
  ],
});

describe("top traders from the leaderboard", () => {
  it("keeps profitable real accounts, drops market makers, best month first", () => {
    const rows = [
      row(1, { pnl: 50_000, vlm: 1e6 }),
      row(2, { pnl: 900_000, vlm: 5e6 }),
      row(3, { pnl: 2_000_000, vlm: 1e9 }), // 10,000x its account: a market maker
      row(4, { pnl: 80_000, vlm: 1e6 }, 20_000), // too small
      row(5, { pnl: -10, vlm: 1e5 }), // losing this month
      row(6, { pnl: 70_000, vlm: 1e6 }, 100_000, -5), // losing all time
      { ethAddress: "nope", accountValue: "1e9", windowPerformances: [] },
      row(7, { pnl: 60_000, vlm: 1e6 }),
    ];
    expect(pickTopTraders(rows, 10)).toEqual([A(2), A(7), A(1)]);
    expect(pickTopTraders(rows, 2)).toEqual([A(2), A(7)]);
    expect(pickTopTraders([], 5)).toEqual([]);
  });
});

describe("whale aggregator", () => {
  const trade = (p: Partial<HlTrade>): HlTrade => ({ coin: "BTC", side: "B", px: "100000", sz: "1", time: 1_000_000, hash: "0xabc", tid: Math.random(), users: [A(9), A(8)], ...p });

  it("sums one taker order across levels and emits it once it's quiet", () => {
    const out: Whale[] = [];
    const agg = createWhaleAggregator({ minUsd: (c) => (c === "BTC" ? 1e6 : 2e5), onWhale: (w) => out.push(w) });
    const now = 1_000_000;
    agg.add(trade({ px: "100000", sz: "6", tid: 1 }), now);
    agg.add(trade({ px: "100100", sz: "4", tid: 2 }), now + 100);
    agg.add(trade({ px: "100100", sz: "4", tid: 2 }), now + 150); // same trade twice (resubscribe)
    agg.add(trade({ side: "A", px: "99000", sz: "1", tid: 3, hash: "0xdef" }), now); // another, small order: seller A(8) is taker
    agg.flush(now + 1000);
    expect(out).toHaveLength(0); // still filling
    agg.flush(now + 3000);
    expect(out).toEqual([{ id: `whale:BTC:${A(9)}:0xabc`, coin: "BTC", taker: A(9), side: "buy", size: 1_000_400, sz: 10, px: 100040, time: now }]);
    expect(agg.pending()).toBe(0);
  });

  it("uses the coin threshold, skips old replays and trades without users", () => {
    const out: Whale[] = [];
    const agg = createWhaleAggregator({ minUsd: (c) => (c === "BTC" ? 1e6 : 2e5), onWhale: (w) => out.push(w) });
    const now = 5_000_000;
    agg.add(trade({ coin: "SOL", px: "200", sz: "1500", time: now, side: "A", tid: 10 }), now); // $300K sell: seller is taker
    agg.add(trade({ coin: "BTC", px: "100000", sz: "5", time: now, tid: 11 }), now); // $500K BTC: under the major threshold
    agg.add(trade({ coin: "SOL", px: "200", sz: "5000", time: now - 120_000, tid: 12 }), now); // replayed, 2 minutes old
    agg.add({ ...trade({ coin: "SOL", px: "200", sz: "5000", time: now, tid: 13 }), users: undefined }, now);
    agg.flush(now, true);
    expect(out.map((w) => [w.coin, w.taker, w.side, w.size])).toEqual([["SOL", A(8), "sell", 300_000]]);
  });

  it("groups hashless fills by taker and second", () => {
    const out: Whale[] = [];
    const agg = createWhaleAggregator({ minUsd: () => 1e5, onWhale: (w) => out.push(w) });
    const z = "0x0000000000000000000000000000000000000000000000000000000000000000";
    agg.add(trade({ hash: z, px: "100000", sz: "0.6", time: 7_000_100, tid: 20 }), 7_000_200);
    agg.add(trade({ hash: z, px: "100000", sz: "0.6", time: 7_000_900, tid: 21 }), 7_000_950);
    agg.flush(7_100_000);
    expect(out.map((w) => [w.id, w.size])).toEqual([[`whale:BTC:${A(9)}:t7000`, 120_000]]);
  });
});

let t: Awaited<ReturnType<typeof setupTestApp>>;
const MEMBER = "0x00000000000000000000000000000000000000e1";

beforeAll(async () => {
  t = await setupTestApp();
  t.auth.wallets["mia"] = [MEMBER];
  await t.prisma.inviteCode.create({ data: { code: "SWELL-EXT", maxUses: 5 } });
  const r = await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer("mia"), payload: { code: "SWELL-EXT", address: MEMBER, acceptTerms: true } });
  expect(r.json().created).toBe(true);
});

afterAll(async () => {
  await t?.close();
});

class FakeHl implements IndexerInfo {
  fills: HlFill[] = [];
  starts: number[] = [];
  accounts = 0;
  async userFillsByTime(_u: string, start: number) {
    this.starts.push(start);
    return this.fills.filter((f) => f.time >= start);
  }
  async account() {
    this.accounts++;
    return { accountValue: 5e6, lev: { ETH: 20 } };
  }
  async monthEquity(): Promise<[number, string][]> {
    throw new Error("not for top traders");
  }
}

describe("top traders, whales and the feed", () => {
  it("follows top traders lightly: big trades only, a day of history, no stats", async () => {
    await setTopTraders(t.prisma, [A(100), A(101), MEMBER]);
    expect(await t.prisma.user.count({ where: { kind: "top" } })).toBe(2);
    expect((await t.prisma.user.findUnique({ where: { address: MEMBER } }))!.kind).toBe("member"); // members stay members
    const top = (await t.prisma.user.findUnique({ where: { address: A(100) } }))!;
    expect(top).toMatchObject({ handle: "hl_000000", privyId: `hl:${A(100)}` });

    const clock = Date.now();
    const hl = new FakeHl();
    let tid = 1;
    const f = (oid: number, sz: string, dir = "Open Long"): HlFill => ({ coin: "ETH", px: "3000", sz, side: dir.includes("Long") === dir.startsWith("Open") ? "B" : "A", time: clock - 60_000 + oid, startPosition: "0", dir, closedPnl: "0", hash: `0x${tid.toString(16)}`, oid, fee: "1", feeToken: "USDC", tid: tid++ });
    hl.fills = [f(1, "10"), f(2, "1"), ...[3, 4, 5, 6, 7, 8].map((o) => f(o, "20"))]; // $30K, $3K, then six $60K opens
    const ix = createIndexer({ prisma: t.prisma, redis: t.redis, info: hl, rpm: 1000, now: () => clock, log: () => {} });
    await ix.pollUser({ id: top.id, address: top.address, kind: "top" });
    expect(hl.starts[0]).toBe(clock - TOP.backfillMs);
    const acts = await t.prisma.activity.findMany({ where: { userId: top.id }, orderBy: { createdAt: "desc" } });
    // the $3K order is skipped, and at most five new events per poll (the newest)
    expect(acts.map((a) => (a.data as { oid: number }).oid)).toEqual([8, 7, 6, 5, 4]);
    expect(acts[0]!.data).toMatchObject({ coin: "ETH", side: "long", lev: 20, size: 60_000 });
    expect(await t.prisma.dailyStat.count({ where: { userId: top.id } })).toBe(0);
    const st = (await t.prisma.indexState.findUnique({ where: { userId: top.id } }))!;
    expect(st.nextPollAt.getTime() - clock).toBeGreaterThanOrEqual(TOP.minPollMs);

    // Quiet poll: a single request, no account calls.
    const before = hl.accounts;
    hl.fills = [];
    await ix.pollUser({ id: top.id, address: top.address, kind: "top" });
    expect(hl.accounts).toBe(before);
  });

  it("stores whale trades for unknown addresses only", async () => {
    const w = (taker: string, id: string): Whale => ({ id, coin: "SOL", taker, side: "sell", size: 412_345.6, sz: 2061.7, px: 200.003, time: Date.now() - 1000 });
    expect(await saveWhale(t.prisma, t.redis, w(A(200), "whale:SOL:a:0x1"))).toBe(true);
    expect(await saveWhale(t.prisma, t.redis, w(A(200), "whale:SOL:a:0x1"))).toBe(false); // once
    expect(await saveWhale(t.prisma, t.redis, w(A(100), "whale:SOL:b:0x2"))).toBe(false); // a top trader: their own events cover it
    expect(await saveWhale(t.prisma, t.redis, w(MEMBER, "whale:SOL:c:0x3"))).toBe(false); // a member, likewise
    const whale = (await t.prisma.user.findUnique({ where: { address: A(200) } }))!;
    expect(whale.kind).toBe("external");
    expect((await t.prisma.activity.findUnique({ where: { id: "whale:SOL:a:0x1" } }))!.data).toEqual({ coin: "SOL", side: "sell", size: 412_346, sz: 2061.7, px: 200.003 });
  });

  it("filters the feed by source; external rows stay out of members-only lists", async () => {
    const feed = async (q: string) => (await t.app.inject({ url: `/api/activity?${q}` })).json().items as { kind: string; user: { kind: string; address: string } }[];
    expect((await feed("source=whales")).map((i) => [i.kind, i.user.kind])).toEqual([["whale", "external"]]);
    const top = await feed("source=top");
    expect(top).toHaveLength(5);
    expect(new Set(top.map((i) => i.user.kind))).toEqual(new Set(["top"]));
    expect(await feed("source=swellfi")).toHaveLength(0);
    expect(await feed("source=all&kind=trades")).toHaveLength(6);
    expect(await feed("source=all&kind=open")).toHaveLength(5); // whale trades aren't opens
    expect((await t.app.inject({ url: "/api/activity?source=nope" })).statusCode).toBe(400);
    // Platform stats and search only count members.
    await t.redis.del("tl:stats");
    expect((await t.app.inject({ url: "/api/stats" })).json().users).toBe(1);
    expect((await t.app.inject({ url: "/api/search?q=hl_" })).json().traders).toHaveLength(0);
    // A top trader can be followed.
    const top100 = (await t.prisma.user.findUnique({ where: { address: A(100) } }))!;
    expect((await t.app.inject({ method: "POST", url: `/api/users/${top100.id}/follow`, headers: bearer("mia") })).json().following).toBe(true);
    expect(await (async () => (await t.app.inject({ url: "/api/activity?scope=following&kind=trades", headers: bearer("mia") })).json().items.length)()).toBe(5);
  });

  it("an external address can't log in; its owner claims it by signing up", async () => {
    // Sessions carry Privy ids or "wallet:0x…", never the "hl:0x…" placeholder: the owner shows up as unregistered.
    t.auth.wallets["whale-owner"] = [A(200)];
    expect((await t.app.inject({ url: "/api/me", headers: bearer("whale-owner") })).statusCode).toBe(404); // not registered yet
    const r = await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer("whale-owner"), payload: { code: "SWELL-EXT", address: A(200), acceptTerms: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ kind: "member", handle: expect.stringMatching(/^trader_000000/) });
    const u = (await t.prisma.user.findUnique({ where: { address: A(200) } }))!;
    expect(u).toMatchObject({ kind: "member", privyId: "whale-owner" });
    expect(await t.prisma.activity.count({ where: { userId: u.id, kind: "whale" } })).toBe(1); // history kept
    expect((await t.app.inject({ url: "/api/me", headers: bearer("whale-owner") })).json().user.kind).toBe("member");
    // A member's wallet can't be taken.
    t.auth.wallets["thief"] = [MEMBER];
    expect((await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer("thief"), payload: { code: "SWELL-EXT", address: MEMBER, acceptTerms: true } })).statusCode).toBe(409);
  });

  it("drops traders off the list and cleans up old external data", async () => {
    const r = await setTopTraders(t.prisma, [A(101)]);
    expect(r).toEqual({ following: 1, dropped: 1 });
    expect((await t.prisma.user.findUnique({ where: { address: A(100) } }))!.kind).toBe("external");
    await externalUser(t.prisma, A(300), "external"); // seen once, nothing kept
    const old = Date.now() + 8 * 864e5; // a week from now everything above is old
    const c = await cleanupExternal(t.prisma, old);
    // Whale trades are short-lived feed items (whoever's they are now); followed traders' rows stay.
    expect(c).toMatchObject({ whales: 1, events: 5, users: 1 });
    expect(await t.prisma.user.findUnique({ where: { address: A(300) } })).toBeNull();
    expect(await t.prisma.user.findUnique({ where: { address: A(100) } })).not.toBeNull(); // mia follows them
  });
});
