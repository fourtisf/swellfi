import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startOfUtcDay } from "../src/lib/stats";
import { bearer, D, setupTestApp } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupTestApp>>;
let t: Ctx;

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const ADMIN = "0x00000000000000000000000000000000000000ad";

async function makeTrader(handle: string, equities: number[], extra: { isPublic?: boolean } = {}) {
  const today = startOfUtcDay();
  const user = await t.prisma.user.create({
    data: { privyId: `p:${handle}`, address: `0x${handle.padEnd(40, "0").slice(0, 40)}`, handle, referralCode: `rc${handle}`, isPublic: extra.isPublic ?? true },
  });
  await t.prisma.dailyStat.createMany({
    data: equities.map((eq, i) => ({
      userId: user.id,
      date: new Date(today.getTime() - (equities.length - 1 - i) * 864e5),
      pnl: D(i ? eq - equities[i - 1]! : 0),
      volume: D(1000),
      equity: D(eq),
      trades: 2,
      closedTrades: 2,
      wins: 1,
    })),
  });
  return user;
}

beforeAll(async () => {
  t = await setupTestApp();
  t.auth.wallets["alice"] = [ALICE];
  t.auth.wallets["bob"] = [BOB];
  t.auth.wallets["admin"] = [ADMIN];
  await t.prisma.inviteCode.create({ data: { code: "SWELL-TEST", maxUses: 2 } });
});

afterAll(async () => {
  await t?.close();
});

describe("auth + invite gating", () => {
  it("rejects bad tokens and anonymous /me", async () => {
    expect((await t.app.inject({ url: "/api/me" })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/me", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });

  it("reports NOT_REGISTERED for a Privy user without an account", async () => {
    const r = await t.app.inject({ url: "/api/me", headers: bearer("alice") });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ error: "NOT_REGISTERED", inviteOnly: true });
    expect((await t.app.inject({ url: "/api/watchlist", headers: bearer("alice") })).statusCode).toBe(403);
  });

  it("requires an invite, accepted terms and a linked wallet", async () => {
    const post = (body: object, who = "alice") => t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer(who), payload: body });
    expect((await post({ address: ALICE, acceptTerms: true })).json().error).toBe("INVITE_REQUIRED");
    expect((await post({ code: "SWELL-TEST", address: ALICE, acceptTerms: false })).statusCode).toBe(400);
    expect((await post({ code: "SWELL-TEST", address: BOB, acceptTerms: true })).json().error).toBe("WALLET_NOT_LINKED");
    expect((await post({ code: "NOPE-1234", address: ALICE, acceptTerms: true })).json().error).toBe("INVALID_INVITE");

    const ok = await post({ code: "swell-test", address: ALICE.toUpperCase().replace("0X", "0x"), acceptTerms: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ created: true, user: { address: ALICE, handle: "trader_111111" } });
    // idempotent
    expect((await post({ code: "SWELL-TEST", address: ALICE, acceptTerms: true })).json().created).toBe(false);

    const me = await t.app.inject({ url: "/api/me", headers: bearer("alice") });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.handle).toBe("trader_111111");
    expect(me.json().isAdmin).toBe(false);
  });

  it("stops at maxUses", async () => {
    const post = (who: string, address: string) =>
      t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer(who), payload: { code: "SWELL-TEST", address, acceptTerms: true } });
    expect((await post("bob", BOB)).statusCode).toBe(200);
    expect((await post("admin", ADMIN)).json().error).toBe("INVALID_INVITE");
    const code = await t.prisma.inviteCode.findUnique({ where: { code: "SWELL-TEST" } });
    expect(code?.uses).toBe(2);
  });
});

describe("watchlist", () => {
  it("starts with defaults and persists changes per user", async () => {
    const get = async () => (await t.app.inject({ url: "/api/watchlist", headers: bearer("alice") })).json().coins;
    expect(await get()).toEqual(["BTC", "ETH", "HYPE", "SOL", "xyz:SP500"]);
    const add = await t.app.inject({ method: "POST", url: "/api/watchlist", headers: bearer("alice"), payload: { coin: "xyz:NVDA", starred: true } });
    expect(add.json().coins).toContain("xyz:NVDA");
    await t.app.inject({ method: "POST", url: "/api/watchlist", headers: bearer("alice"), payload: { coin: "ETH", starred: false } });
    expect(await get()).toEqual(["BTC", "HYPE", "SOL", "xyz:SP500", "xyz:NVDA"]);
    const bad = await t.app.inject({ method: "POST", url: "/api/watchlist", headers: bearer("alice"), payload: { coin: "<script>", starred: true } });
    expect(bad.statusCode).toBe(400);
    // Bob's list is separate
    const bob = await t.app.inject({ url: "/api/watchlist", headers: bearer("bob") });
    expect(bob.json().coins).not.toContain("xyz:NVDA");
  });
});

describe("waitlist + admin", () => {
  it("accepts signups without leaking duplicates and lets admins approve", async () => {
    const join = (payload: object) => t.app.inject({ method: "POST", url: "/api/waitlist", payload });
    expect((await join({ email: "New@Example.com", xHandle: "@newbie" })).json()).toEqual({ ok: true });
    expect((await join({ email: "new@example.com" })).json()).toEqual({ ok: true });
    expect((await join({ email: "not-an-email" })).statusCode).toBe(400);
    const entry = await t.prisma.waitlistEntry.findUnique({ where: { email: "new@example.com" } });
    expect(entry?.xHandle).toBe("newbie");
    // Anyone can submit any email, so an existing entry is never changed.
    await join({ email: "new@example.com", xHandle: "hijack" });
    expect((await t.prisma.waitlistEntry.findUnique({ where: { email: "new@example.com" } }))?.xHandle).toBe("newbie");

    expect((await t.app.inject({ url: "/api/admin/waitlist", headers: bearer("alice") })).statusCode).toBe(403);

    // register the admin with a fresh code, then approve
    await t.prisma.inviteCode.create({ data: { code: "SWELL-ADMIN" } });
    await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer("admin"), payload: { code: "SWELL-ADMIN", address: ADMIN, acceptTerms: true } });
    const list = await t.app.inject({ url: "/api/admin/waitlist", headers: bearer("admin") });
    expect(list.json().entries).toHaveLength(1);
    const ok = await t.app.inject({ method: "POST", url: `/api/admin/waitlist/${entry!.id}/approve`, headers: bearer("admin") });
    expect(ok.json().entry).toMatchObject({ status: "approved", inviteCode: expect.stringMatching(/^SWELL-[A-Z2-9]{6}$/) });
  });
});

describe("social reads", () => {
  it("ranks public traders by PnL with ROI from start-of-window equity", async () => {
    await makeTrader("winner", [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1500]);
    await makeTrader("loser", [1000, 1000, 1000, 1000, 1000, 1000, 1000, 800]);
    await makeTrader("hidden", [1000, 1000, 1000, 1000, 1000, 1000, 1000, 9000], { isPublic: false });
    const r = await t.app.inject({ url: "/api/leaderboard?tf=24h" });
    expect(r.statusCode).toBe(200);
    const rows = r.json().rows;
    expect(rows.map((x: { user: { handle: string } }) => x.user.handle)).toEqual(["winner", "loser"]);
    expect(rows[0]).toMatchObject({ rank: 1, pnl: "500.00", roi: 50, winRate: 50, equity: "1500.00" });
    expect(rows[1].maxDrawdown).toBeCloseTo(-20);
    expect((await t.app.inject({ url: "/api/leaderboard?tf=1y" })).statusCode).toBe(400);
  });

  it("serves profiles and hides private ones", async () => {
    const r = await t.app.inject({ url: "/api/users/winner" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ user: { handle: "winner" }, followers: 0, stats: { pnl: "500.00" } });
    expect((await t.app.inject({ url: "/api/users/hidden" })).statusCode).toBe(404);
    expect((await t.app.inject({ url: "/api/users/winner/stats?tf=all" })).json().stats.roi).toBe(50);
  });

  it("returns platform stats, feed, chat and activity", async () => {
    const stats = (await t.app.inject({ url: "/api/stats" })).json();
    expect(stats.users).toBeGreaterThanOrEqual(5);
    expect(Number(stats.tvl)).toBeCloseTo(1500 + 800 + 9000);
    const winner = await t.prisma.user.findUniqueOrThrow({ where: { handle: "winner" } });
    await t.prisma.post.create({ data: { userId: winner.id, text: "long", position: { coin: "BTC", side: "long", lev: 5, entry: 100 } } });
    await t.prisma.chatMessage.create({ data: { userId: winner.id, text: "gm" } });
    await t.prisma.activity.create({ data: { userId: winner.id, kind: "open", data: { coin: "BTC", side: "long", lev: 5, size: 1000, px: 100 } } });
    const feed = (await t.app.inject({ url: "/api/feed" })).json();
    expect(feed.items[0]).toMatchObject({ text: "long", user: { handle: "winner" }, liked: false });
    expect((await t.app.inject({ url: "/api/feed?scope=following" })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/api/chat" })).json().messages[0].text).toBe("gm");
    expect((await t.app.inject({ url: "/api/activity" })).json().items[0]).toMatchObject({ kind: "open", user: { handle: "winner" } });
    expect((await t.app.inject({ url: "/api/activity/summary" })).json()).toMatchObject({ topCoin: "BTC", tradersToday: 3 });
  });

  it("serves rewards for a registered user", async () => {
    const r = await t.app.inject({ url: "/api/rewards", headers: bearer("alice") });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tierIndex: 0, volume30d: "0.00", claimable: "0.00", referral: { invited: 0 } });
    expect(r.json().tiers[0].name).toBe("Current");
  });
});

describe("wallet sign-in", () => {
  it("issues a session for a signed nonce and accepts it as a bearer token", async () => {
    const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
    const acc = privateKeyToAccount(generatePrivateKey());
    const n = await t.app.inject({ method: "POST", url: "/api/auth/nonce", payload: { address: acc.address } });
    const { message } = n.json();
    expect(message).toContain(acc.address);
    // wrong signer
    const other = privateKeyToAccount(generatePrivateKey());
    const bad = await t.app.inject({ method: "POST", url: "/api/auth/wallet", payload: { address: acc.address, signature: await other.signMessage({ message }) } });
    expect(bad.json().error).toBe("BAD_SIGNATURE");
    // nonce is single-use: get a fresh one
    const { message: m2 } = (await t.app.inject({ method: "POST", url: "/api/auth/nonce", payload: { address: acc.address } })).json();
    const ok = await t.app.inject({ method: "POST", url: "/api/auth/wallet", payload: { address: acc.address, signature: await acc.signMessage({ message: m2 }) } });
    expect(ok.statusCode).toBe(200);
    const { token } = ok.json();
    const replay = await t.app.inject({ method: "POST", url: "/api/auth/wallet", payload: { address: acc.address, signature: await acc.signMessage({ message: m2 }) } });
    expect(replay.json().error).toBe("NONCE_EXPIRED");

    const auth = { authorization: `Bearer ${token}` };
    expect((await t.app.inject({ url: "/api/me", headers: auth })).statusCode).toBe(404);
    await t.prisma.inviteCode.create({ data: { code: "SWELL-WALLET" } });
    const reg = await t.app.inject({ remoteAddress: "10.9.9.9", method: "POST", url: "/api/invite/redeem", headers: auth, payload: { code: "SWELL-WALLET", address: acc.address, acceptTerms: true } });
    expect(reg.json()).toMatchObject({ created: true, user: { address: acc.address.toLowerCase() } });
    // can't bind someone else's address
    const steal = await t.app.inject({ remoteAddress: "10.9.9.9", method: "POST", url: "/api/invite/redeem", headers: auth, payload: { code: "SWELL-WALLET", address: other.address, acceptTerms: true } });
    expect(steal.json().created).toBe(false);
    expect((await t.app.inject({ url: "/api/me", headers: auth })).json().user.address).toBe(acc.address.toLowerCase());
    // tampered token
    const forged = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    expect((await t.app.inject({ url: "/api/me", headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
  });
});

describe("client IP", () => {
  it("rate limits by the real client IP, whatever X-Forwarded-For the client sends", async () => {
    // Behind nginx (a loopback peer): only the hop nginx appended counts, not the client's own.
    const viaProxy = (i: number) => t.app.inject({ method: "POST", url: "/api/waitlist", headers: { "x-forwarded-for": `6.6.6.${i}, 9.9.9.9` }, payload: { email: `p${i}@example.com` } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await viaProxy(i)).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    // A peer that isn't the local proxy can't choose its IP at all.
    const direct = await t.app.inject({ remoteAddress: "8.8.8.8", method: "POST", url: "/api/waitlist", headers: { "x-forwarded-for": "9.9.9.9" }, payload: { email: "direct@example.com" } });
    expect(direct.statusCode).toBe(200);
  });
});

describe("wallet sign-in nonces", () => {
  it("can't be cancelled by someone else requesting a nonce or sending a bad signature", async () => {
    const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
    const acc = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const nonce = async () => (await t.app.inject({ remoteAddress: "10.7.7.7", method: "POST", url: "/api/auth/nonce", payload: { address: acc.address } })).json().message as string;
    const signIn = (payload: object) => t.app.inject({ remoteAddress: "10.7.7.7", method: "POST", url: "/api/auth/wallet", payload: { address: acc.address, ...payload } });
    const message = await nonce();
    await nonce(); // a stranger asks for another message for the same address
    expect((await signIn({ message, signature: await other.signMessage({ message }) })).json().error).toBe("BAD_SIGNATURE");
    const ok = await signIn({ message, signature: await acc.signMessage({ message }) });
    expect(ok.statusCode).toBe(200);
    // single use
    expect((await signIn({ message, signature: await acc.signMessage({ message }) })).json().error).toBe("NONCE_EXPIRED");
    // a message the server never issued is refused even if correctly signed
    const fake = message.replace(/Nonce: [0-9a-f]{24}/, `Nonce: ${"0".repeat(24)}`);
    expect((await signIn({ message: fake, signature: await acc.signMessage({ message: fake }) })).json().error).toBe("NONCE_EXPIRED");
  });
});
