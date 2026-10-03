import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEvents, partsOf, rollupDays, type HlFill } from "../src/indexer/events";
import { backoffMs, createIndexer, type IndexerInfo } from "../src/indexer/indexer";
import { parseFeed } from "../src/routes/feed";
import { bearer, setupTestApp } from "./helpers";

let tid = 1;
const fill = (p: Partial<HlFill> & Pick<HlFill, "coin" | "px" | "sz" | "dir" | "oid">): HlFill => ({
  side: /Long$/.test(p.dir) && p.dir.startsWith("Open") ? "B" : "A",
  time: Date.now(),
  startPosition: "0",
  closedPnl: "0",
  hash: `0x${(tid).toString(16).padStart(64, "0")}`,
  fee: "0",
  feeToken: "USDC",
  tid: tid++,
  ...p,
});

describe("fills -> feed events", () => {
  it("groups the fills of one order into one event with the average price", () => {
    const ev = buildEvents("u1", [fill({ coin: "BTC", px: "100000", sz: "0.01", dir: "Open Long", oid: 7 }), fill({ coin: "BTC", px: "100200", sz: "0.03", dir: "Open Long", oid: 7 })], { BTC: 10 });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ id: "fill:u1:7:open", kind: "open", data: { coin: "BTC", side: "long", lev: 10, sz: 0.04, size: 4006, px: 100150 } });
  });

  it("derives entry and net PnL for a close (long and short)", () => {
    const [long] = buildEvents("u1", [fill({ coin: "ETH", px: "3100", sz: "2", dir: "Close Long", closedPnl: "200", fee: "3", oid: 8 })]);
    expect(long!.data).toMatchObject({ side: "long", entry: 3000, exit: 3100, pnl: 197 });
    const [short] = buildEvents("u1", [fill({ coin: "AAVE", px: "176.72", sz: "15.6", dir: "Close Short", closedPnl: "26.052", fee: "0.5", oid: 9 })]);
    expect(short!.data.side).toBe("short");
    expect(short!.data.entry).toBeCloseTo(178.39, 2);
    expect(short!.data.pnl).toBeCloseTo(25.552, 6);
  });

  it("splits a flip into a close and an open, and skips spot", () => {
    const flip = fill({ coin: "SOL", px: "200", sz: "3", dir: "Long > Short", startPosition: "1", closedPnl: "10", fee: "0.3", oid: 10 });
    expect(partsOf(flip).map((p) => [p.kind, p.side, p.sz])).toEqual([["close", "long", 1], ["open", "short", 2]]);
    const ev = buildEvents("u1", [flip, fill({ coin: "@107", px: "40", sz: "1", dir: "Buy", oid: 11 }), fill({ coin: "PURR/USDC", px: "1", sz: "5", dir: "Sell", oid: 12 })]);
    expect(ev.map((e) => e.id).sort()).toEqual(["fill:u1:10:close", "fill:u1:10:open"]);
    expect(ev.find((e) => e.kind === "close")!.data.pnl).toBeCloseTo(9.9, 6);
  });

  it("rolls up daily PnL, volume and wins", () => {
    const t = Date.UTC(2026, 9, 2, 12);
    const [d] = rollupDays([
      fill({ coin: "BTC", px: "100", sz: "1", dir: "Open Long", fee: "0.1", oid: 1, time: t }),
      fill({ coin: "BTC", px: "110", sz: "1", dir: "Close Long", closedPnl: "10", fee: "0.1", oid: 2, time: t + 1000 }),
      fill({ coin: "ETH", px: "50", sz: "1", dir: "Close Short", closedPnl: "-4", fee: "0.1", oid: 3, time: t + 2000 }),
    ]);
    expect(d).toMatchObject({ date: new Date(Date.UTC(2026, 9, 2)), trades: 3, closedTrades: 2, wins: 1, volume: 260 });
    expect(d!.pnl).toBeCloseTo(5.7, 6);
  });

  it("backs off quiet accounts up to 15 minutes", () => {
    expect([0, 1, 2, 3, 6, 8, 20].map(backoffMs)).toEqual([5_000, 5_000, 15_000, 30_000, 240_000, 900_000, 900_000]);
  });
});

describe("news feed parser", () => {
  it("reads RSS and Atom items as plain text with https links only", () => {
    const rss = `<rss><channel>
      <item><title><![CDATA[Bitcoin <b>tops</b> $100K &amp; more]]></title><link>https://example.com/a</link><pubDate>Thu, 02 Oct 2026 08:00:00 GMT</pubDate></item>
      <item><title>Bad</title><link>javascript:alert(1)</link></item>
      <item><title>Plain http</title><link>http://example.com/b</link></item>
      </channel></rss>`;
    expect(parseFeed(rss, "Test")).toEqual([{ title: "Bitcoin tops $100K & more", url: "https://example.com/a", source: "Test", publishedAt: "2026-10-02T08:00:00.000Z" }]);
    const atom = `<feed><entry><title>Atom &#8217;s</title><link href="https://example.com/c"/><updated>2026-10-02T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, "A")[0]).toMatchObject({ title: "Atom ’s", url: "https://example.com/c" });
  });
});

// ---------------------------------------------------------------- indexer against the test DB
type Ctx = Awaited<ReturnType<typeof setupTestApp>>;
let t: Ctx;
const ERIN = "0x5555555555555555555555555555555555555555";
const FRANK = "0x6666666666666666666666666666666666666666";

class FakeHl implements IndexerInfo {
  fills: HlFill[] = [];
  accountValue = 1000;
  lev: Record<string, number> = {};
  calls = 0;
  async userFillsByTime(_u: string, start: number) {
    this.calls++;
    return this.fills.filter((f) => f.time >= start).sort((a, b) => a.time - b.time);
  }
  async account(_u: string, dex: string) {
    this.calls++;
    return dex ? { accountValue: 0, lev: {} } : { accountValue: this.accountValue, lev: this.lev };
  }
  async monthEquity() {
    this.calls++;
    const day = 864e5;
    return [[Date.now() - 2 * day, "900"], [Date.now() - day, "950"]] as [number, string][];
  }
}

beforeAll(async () => {
  t = await setupTestApp();
  t.auth.wallets["erin"] = [ERIN];
  t.auth.wallets["frank"] = [FRANK];
  await t.prisma.inviteCode.create({ data: { code: "SWELL-IDX", maxUses: 5 } });
  for (const [who, address] of [["erin", ERIN], ["frank", FRANK]] as const) {
    const r = await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer(who), payload: { code: "SWELL-IDX", address, acceptTerms: true } });
    expect(r.json().created).toBe(true);
  }
});

afterAll(async () => {
  await t?.close();
});

describe("indexer", () => {
  it("turns new fills into feed events, stats and equity, and converges partial fills", async () => {
    const hl = new FakeHl();
    let clock = Date.now();
    const ix = createIndexer({ prisma: t.prisma, redis: t.redis, info: hl, dexes: ["xyz"], rpm: 1000, now: () => clock, log: () => {} });
    const erin = (await t.prisma.user.findUnique({ where: { address: ERIN } }))!;

    hl.lev = { BTC: 5 };
    hl.fills.push(fill({ coin: "BTC", px: "100000", sz: "0.01", dir: "Open Long", oid: 501, time: clock - 5000 }));
    expect(await ix.enroll()).toBeGreaterThanOrEqual(2);
    expect(await ix.pollUser({ id: erin.id, address: ERIN })).toBe(1);

    let acts = await t.prisma.activity.findMany({ where: { userId: erin.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ id: `fill:${erin.id}:501:open`, kind: "open", data: { coin: "BTC", side: "long", lev: 5, size: 1000 } });
    // Equity: history backfilled, today's from the account.
    const stats = await t.prisma.dailyStat.findMany({ where: { userId: erin.id }, orderBy: { date: "asc" } });
    expect(stats.map((s) => Number(s.equity))).toEqual([900, 950, 1000]);
    expect(stats.at(-1)).toMatchObject({ trades: 1 });

    // More of the same order fills later, then the position is closed for a profit.
    clock += 30_000;
    hl.fills.push(fill({ coin: "BTC", px: "100100", sz: "0.01", dir: "Open Long", oid: 501, time: clock - 2000 }));
    hl.fills.push(fill({ coin: "BTC", px: "101000", sz: "0.02", dir: "Close Long", closedPnl: "19", fee: "1", oid: 502, time: clock - 1000 }));
    hl.lev = {};
    expect(await ix.pollUser({ id: erin.id, address: ERIN })).toBe(2);
    acts = await t.prisma.activity.findMany({ where: { userId: erin.id }, orderBy: { createdAt: "asc" } });
    expect(acts.map((a) => a.kind)).toEqual(["open", "close"]);
    expect(acts[0]!.data).toMatchObject({ sz: 0.02, size: 2001, px: 100050 });
    // The close keeps the leverage seen when the position was opened.
    expect(acts[1]!.data).toMatchObject({ side: "long", pnl: 18, exit: 101000, entry: 100050, lev: 5 });
    const today = (await t.prisma.dailyStat.findMany({ where: { userId: erin.id }, orderBy: { date: "desc" }, take: 1 }))[0]!;
    expect(Number(today.pnl)).toBeCloseTo(18, 6);
    expect(today).toMatchObject({ trades: 2, closedTrades: 1, wins: 1 });

    // Nothing new: no duplicates, and the next poll backs off.
    const before = await t.prisma.fill.count({ where: { userId: erin.id } });
    expect(await ix.pollUser({ id: erin.id, address: ERIN })).toBe(0);
    expect(await t.prisma.fill.count({ where: { userId: erin.id } })).toBe(before);
    const st = (await t.prisma.indexState.findUnique({ where: { userId: erin.id } }))!;
    expect(st.idleStreak).toBe(1);
    expect(st.nextPollAt.getTime() - clock).toBe(5_000);
  });

  it("never lets a finishing poll push back a sync that arrived during it", async () => {
    const frank = (await t.prisma.user.findUnique({ where: { address: FRANK } }))!;
    const hl = new FakeHl();
    const clock = Date.now();
    const ix = createIndexer({ prisma: t.prisma, redis: t.redis, info: hl, rpm: 1000, now: () => clock, log: () => {} });
    await ix.pollUser({ id: frank.id, address: FRANK }); // first poll: backfill, nothing new
    // Next poll: a trade lands and the app calls /me/sync while the indexer is fetching.
    const syncAt = new Date(clock + 1000);
    hl.userFillsByTime = async () => {
      await t.prisma.indexState.update({ where: { userId: frank.id }, data: { nextPollAt: syncAt } });
      return [];
    };
    await ix.pollUser({ id: frank.id, address: FRANK });
    expect((await t.prisma.indexState.findUnique({ where: { userId: frank.id } }))!.nextPollAt.getTime()).toBe(syncAt.getTime());
    // Without a sync, the normal backoff applies.
    hl.userFillsByTime = async () => [];
    await ix.pollUser({ id: frank.id, address: FRANK });
    expect((await t.prisma.indexState.findUnique({ where: { userId: frank.id } }))!.nextPollAt.getTime()).toBe(clock + backoffMs(3));
  });

  it("serves the feed with filters, likes and follows", async () => {
    const erin = (await t.prisma.user.findUnique({ where: { address: ERIN } }))!;
    const frank = (await t.prisma.user.findUnique({ where: { address: FRANK } }))!;
    const all = (await t.app.inject({ url: "/api/activity?kind=trades" })).json();
    expect(all.items.map((i: { kind: string }) => i.kind)).toEqual(["close", "open"]);
    expect((await t.app.inject({ url: "/api/activity?kind=close" })).json().items).toHaveLength(1);
    const closeId = all.items[0].id;

    // likes: once per user, undo works, counts never go negative
    const like = (method: "POST" | "DELETE", who = "frank") => t.app.inject({ method, url: `/api/activity/${encodeURIComponent(closeId)}/like`, headers: bearer(who) });
    expect((await like("POST")).json()).toEqual({ likes: 1, liked: true });
    expect((await like("POST")).json()).toEqual({ likes: 1, liked: true });
    expect((await like("POST", "erin")).json()).toEqual({ likes: 2, liked: true });
    expect((await t.app.inject({ url: "/api/activity?kind=close", headers: bearer("frank") })).json().items[0]).toMatchObject({ likes: 2, liked: true });
    expect((await like("DELETE")).json()).toEqual({ likes: 1, liked: false });
    expect((await like("DELETE")).json()).toEqual({ likes: 1, liked: false });
    expect((await t.app.inject({ method: "POST", url: `/api/activity/${encodeURIComponent(closeId)}/like` })).statusCode).toBe(401);

    // following tab: empty until frank follows erin
    expect((await t.app.inject({ url: "/api/activity?scope=following" })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/activity?scope=following&kind=trades", headers: bearer("frank") })).json().items).toHaveLength(0);
    expect((await t.app.inject({ method: "POST", url: `/api/users/${frank.id}/follow`, headers: bearer("frank") })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "POST", url: `/api/users/${erin.id}/follow`, headers: bearer("frank") })).json()).toEqual({ following: true, followers: 1 });
    const fol = (await t.app.inject({ url: "/api/activity?scope=following&kind=trades", headers: bearer("frank") })).json();
    expect(fol.items).toHaveLength(2);
    expect(fol.items[0].isFollowing).toBe(true);

    // a private account disappears from the global feed (but still sees its own)
    expect((await t.app.inject({ method: "POST", url: "/api/me/profile", headers: bearer("erin"), payload: { isPublic: false } })).json().user.isPublic).toBe(false);
    expect((await t.app.inject({ url: "/api/activity?kind=trades" })).json().items).toHaveLength(0);
    expect((await t.app.inject({ url: "/api/activity?scope=following&kind=trades", headers: bearer("frank") })).json().items).toHaveLength(0);
    expect((await t.app.inject({ url: "/api/activity?scope=following&kind=trades", headers: bearer("erin") })).json().items).toHaveLength(2);
    await t.app.inject({ method: "POST", url: "/api/me/profile", headers: bearer("erin"), payload: { isPublic: true } });

    // summary bar reads the indexed stats
    await t.redis.del("tl:act:sum");
    const sum = (await t.app.inject({ url: "/api/activity/summary" })).json();
    expect(sum).toMatchObject({ tradersToday: 1, topCoin: "BTC" });
    expect(Number(sum.volumeToday)).toBeCloseTo(4021, 0);

    // sync hint makes the indexer look at the account now
    await t.prisma.indexState.update({ where: { userId: erin.id }, data: { nextPollAt: new Date(Date.now() + 864e5) } });
    expect((await t.app.inject({ method: "POST", url: "/api/me/sync", headers: bearer("erin") })).json()).toEqual({ ok: true });
    expect((await t.prisma.indexState.findUnique({ where: { userId: erin.id } }))!.nextPollAt.getTime()).toBeLessThanOrEqual(Date.now());
    // A second call inside the window is deferred to its end, not dropped.
    await t.prisma.indexState.update({ where: { userId: erin.id }, data: { nextPollAt: new Date(Date.now() + 864e5) } });
    expect((await t.app.inject({ method: "POST", url: "/api/me/sync", headers: bearer("erin") })).json()).toEqual({ ok: true });
    const next = (await t.prisma.indexState.findUnique({ where: { userId: erin.id } }))!.nextPollAt.getTime() - Date.now();
    expect(next).toBeGreaterThan(5_000);
    expect(next).toBeLessThanOrEqual(10_000);
  });

  it("keeps both sides when two Swellfi users trade against each other", async () => {
    const erin = (await t.prisma.user.findUnique({ where: { address: ERIN } }))!;
    const frank = (await t.prisma.user.findUnique({ where: { address: FRANK } }))!;
    const time = Date.now() + 60_000; // after both cursors
    const buy = fill({ coin: "SOL", px: "200", sz: "1", dir: "Open Long", oid: 801, time });
    const sell = { ...buy, side: "A" as const, dir: "Open Short", oid: 802 }; // same hash and tid
    const hl = new FakeHl();
    const ix = createIndexer({ prisma: t.prisma, redis: t.redis, info: hl, rpm: 1000, log: () => {} });
    hl.fills = [buy];
    expect(await ix.pollUser({ id: erin.id, address: ERIN })).toBe(1);
    hl.fills = [sell];
    expect(await ix.pollUser({ id: frank.id, address: FRANK })).toBe(1);
    expect(await t.prisma.fill.count({ where: { hash: buy.hash } })).toBe(2);
    const acts = await t.prisma.activity.findMany({ where: { id: { in: [`fill:${erin.id}:801:open`, `fill:${frank.id}:802:open`] } } });
    expect(acts.map((a) => (a.data as { side: string }).side).sort()).toEqual(["long", "short"]);
  });
});
