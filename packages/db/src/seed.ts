/**
 * Seed script.
 *  - Always: creates the invite codes listed in SEED_INVITE_CODES.
 *  - SEED_DEMO=true (dev only): demo traders with 60 days of stats, follows, posts,
 *    activity, chat and funds, so every screen has content before the Phase 3 indexer
 *    exists. Demo rows are flagged isDemo and can be removed with `--purge-demo`.
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const D = (n: number) => new Prisma.Decimal(n.toFixed(8));

// Deterministic PRNG (prototype `rng`).
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANDLES = ["deepwaterdesk", "kaito.hl", "lumen_capital", "sarifah", "nordicperp", "bayu.eth", "mira_q", "atlasbasis", "gwei_whisperer", "tanjung", "orca_flow", "helix.trade", "rinjani", "quietcarry", "neko_scalps", "pelagic", "arjuna_dex", "solstice", "vantage0x", "bluewater"];
const BIOS = ["Swing trader, majors only.", "Funding-rate arb and basis.", "Momentum on alts, tight stops.", "Macro book: indices, gold, oil.", "Scalps BTC and ETH on the 5m."];
const NOTES = ["Funding flipped negative while price held the range. Squeeze setup, stop under the weekly low.", "Taking half off here. Leaving the rest with the stop at entry.", "Fading this pump. Open interest rose faster than spot volume.", "Rotating out of majors into the index while volatility is cheap.", "Gold breaking out against every currency. Adding on the retest.", "Clean reclaim of the 4h trend line. Small size, wide stop.", "Still holding. Thesis unchanged until the daily closes below support."];
const CHAT = ["BTC holding the range nicely", "who else is short HYPE here", "funding on SOL is getting spicy", "closed my ETH long +18%, ty", "gold perps are underrated", "NVDA earnings next week, careful with leverage", "anyone watching the S&P open?", "added to my BTC long on that wick", "gm traders", "that liquidation cascade was wild", "PUMP volume is insane today", "tight stops, small size, live to trade tomorrow"];
const FUND_NAMES = ["Deepwater Macro", "Kaito Momentum", "Lumen Basis", "Sarifah Majors", "Nordic Trend", "Bayu Alpha", "Mira Quant", "Atlas Carry"];
const FUND_STRATS = ["Indices, gold and oil, 2–5x, weekly holds.", "Trend-following on top 20 alts with trailing stops.", "Delta-neutral funding capture on majors.", "BTC, ETH and SOL only. Low leverage, long bias.", "Systematic breakouts across crypto and stocks.", "Discretionary and event-driven, high conviction.", "Mean reversion on intraday ranges.", "Short-dated carry and basis trades."];

// Fallback reference prices when the Hyperliquid API isn't reachable from the seeding machine.
const REF_PX: Record<string, [number, number]> = {
  BTC: [96420, 40], ETH: [3480, 25], SOL: [212, 20], HYPE: [41.2, 10], XRP: [2.41, 20], DOGE: [0.271, 10],
  SUI: [4.12, 10], AVAX: [38.6, 10], "xyz:NVDA": [182.4, 10], "xyz:GOLD": [3840, 20], "xyz:SP500": [6620, 20], "xyz:TSLA": [418.2, 10],
};

async function livePrices(): Promise<Record<string, number>> {
  const net = process.env.NEXT_PUBLIC_HL_DATA_NETWORK || process.env.NEXT_PUBLIC_HL_NETWORK;
  const url = process.env.NEXT_PUBLIC_HL_INFO_URL || (net === "mainnet" ? "https://api.hyperliquid.xyz/info" : "https://api.hyperliquid-testnet.xyz/info");
  const out: Record<string, number> = {};
  for (const dex of ["", ...(process.env.NEXT_PUBLIC_HL_HIP3_DEXES ?? "").split(",").filter(Boolean)]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(dex ? { type: "allMids", dex } : { type: "allMids" }), signal: AbortSignal.timeout(5000) });
      if (res.ok) for (const [k, v] of Object.entries((await res.json()) as Record<string, string>)) out[k] = +v;
    } catch {
      /* offline: fall back to reference prices */
    }
  }
  return out;
}

const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function seedInvites() {
  const codes = (process.env.SEED_INVITE_CODES ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  for (const code of codes) {
    await prisma.inviteCode.upsert({ where: { code }, update: {}, create: { code, maxUses: 100, note: "seed" } });
  }
  if (codes.length) console.log(`invite codes: ${codes.join(", ")}`);
}

async function purgeDemo() {
  const r = await prisma.user.deleteMany({ where: { isDemo: true } });
  console.log(`removed ${r.count} demo users (and their stats, posts, activity, chat, funds)`);
}

async function seedDemo() {
  const R = rng(20261001);
  const hex = (n: number) => Array.from({ length: n }, () => ((R() * 16) | 0).toString(16)).join("");
  const today = dayStart(new Date());
  const live = await livePrices();
  const px = (coin: string) => live[coin] ?? REF_PX[coin]?.[0];
  const coins = Object.keys(REF_PX).filter((c) => px(c));

  await purgeDemo();

  const users: { user: Awaited<ReturnType<typeof prisma.user.create>>; series: number[] }[] = [];
  for (const [i, h] of HANDLES.entries()) {
    const skill = 1 - i / HANDLES.length;
    const base = (R() * 0.8 + 0.4) * skill;
    const series: number[] = [];
    let v = 100;
    for (let k = 0; k < 60; k++) {
      v *= 1 + (R() - 0.46 + base * 0.04) * 0.05;
      series.push(v);
    }
    const eq = (R() * 2e6 + 8e4) * (1 + skill);
    const totalVol = eq * (R() * 40 + 8);
    const win = 0.45 + R() * 0.28;
    const user = await prisma.user.create({
      data: {
        privyId: `demo:${h}`,
        address: `0x${hex(40)}`,
        handle: h,
        bio: BIOS[i % BIOS.length],
        isDemo: true,
        referralCode: `demo${hex(6)}`,
        xHandle: i % 3 === 0 ? h.replace(/[^a-z0-9_]/gi, "") : null,
        xVerified: i % 3 === 0,
        termsAcceptedAt: new Date(),
        createdAt: new Date(today.getTime() - 61 * 864e5),
      },
    });
    users.push({ user, series });
    const last = series[59]!;
    const stats = series.map((s, k) => {
      const equity = (eq * s) / last;
      const prevEq = k ? (eq * series[k - 1]!) / last : equity / (s / 100);
      const trades = 4 + ((R() * 30) | 0);
      const closedTrades = Math.max(1, (trades * 0.6) | 0);
      return {
        userId: user.id,
        date: new Date(today.getTime() - (59 - k) * 864e5),
        pnl: D(equity - prevEq),
        volume: D((totalVol / 60) * (0.4 + R() * 1.2)),
        equity: D(equity),
        trades,
        closedTrades,
        wins: Math.round(closedTrades * win),
      };
    });
    await prisma.dailyStat.createMany({ data: stats });
  }

  // Follows: everyone follows a handful of the top traders.
  const follows = [];
  for (const [i, { user }] of users.entries()) {
    for (let k = 0; k < 6; k++) {
      const target = users[(i + 1 + ((R() * 8) | 0)) % users.length]!.user;
      if (target.id !== user.id) follows.push({ followerId: user.id, followingId: target.id });
    }
  }
  await prisma.follow.createMany({ data: follows, skipDuplicates: true });

  // Posts with an attached position snapshot.
  const pool = coins.slice(0, 12);
  for (let i = 0; i < 9; i++) {
    const u = users[(i * 7) % 12]!.user;
    const coin = pool[i % pool.length]!;
    const side = R() > 0.4 ? "long" : "short";
    const lev = Math.min(REF_PX[coin]?.[1] ?? 10, [3, 5, 10, 20][i % 4]!);
    const entry = px(coin)! * (1 + (side === "long" ? -1 : 1) * R() * 0.03);
    await prisma.post.create({
      data: {
        userId: u.id,
        text: NOTES[i % NOTES.length]!,
        position: { coin, side, lev, entry },
        likes: (R() * 300) | 0,
        replies: (R() * 40) | 0,
        createdAt: new Date(Date.now() - (i * 37 + R() * 30) * 6e4),
      },
    });
  }

  // Funds (Phase 4 lists real Hyperliquid vaults; these are display-only).
  const funds = [];
  for (let i = 0; i < 8; i++) {
    const { user, series } = users[i]!;
    const s30 = series.slice(30);
    let pk = 0;
    let dd = 0;
    for (const x of series) {
      pk = Math.max(pk, x);
      dd = Math.min(dd, x / pk - 1);
    }
    funds.push(
      await prisma.fund.create({
        data: {
          name: FUND_NAMES[i]!,
          managerId: user.id,
          strategy: FUND_STRATS[i]!,
          perfFeePct: D([20, 15, 10, 20, 25, 15, 10, 12][i]!),
          risk: [3, 4, 1, 2, 3, 5, 2, 1][i]!,
          minDeposit: D([100, 50, 250, 10, 100, 25, 500, 50][i]!),
          aum: D((R() * 9e6 + 4e5) * (1 - i * 0.06)),
          members: (R() * 1400 + 40) | 0,
          return30d: D((s30[s30.length - 1]! / s30[0]! - 1) * 100),
          maxDrawdown: D(dd * 100),
          series: s30,
          isDemo: true,
        },
      }),
    );
  }

  // Live activity.
  const acts = [];
  for (let i = 0; i < 14; i++) {
    const { user } = users[(R() * users.length) | 0]!;
    const coin = pool[(R() * pool.length) | 0]!;
    const r = R();
    const time = new Date(Date.now() - (14 - i) * (60 + R() * 240) * 1e3);
    const side = R() > 0.45 ? "long" : "short";
    const size = Math.round((R() * 40 + 0.5) * 1e3);
    const lev = Math.min([2, 3, 5, 10, 20][(R() * 5) | 0]!, REF_PX[coin]?.[1] ?? 10);
    if (r < 0.16 && user.xHandle) acts.push({ userId: user.id, kind: "verify", data: { xHandle: user.xHandle }, createdAt: time });
    else if (r < 0.28) {
      const f = funds[(R() * funds.length) | 0]!;
      acts.push({ userId: user.id, kind: "fund", data: { fundId: f.id, fundName: f.name, amount: [50, 100, 250, 500, 1000][(R() * 5) | 0], members: f.members, return30d: Number(f.return30d) }, createdAt: time });
    } else if (r < 0.36) {
      const o = users[(R() * 8) | 0]!;
      if (o.user.id === user.id) continue;
      const s = o.series;
      acts.push({ userId: user.id, kind: "follow", data: { handle: o.user.handle, roi30d: (s[59]! / s[30]! - 1) * 100 }, createdAt: time });
    } else if (r < 0.72) acts.push({ userId: user.id, kind: "open", data: { coin, side, lev, size, px: px(coin) }, createdAt: time });
    else acts.push({ userId: user.id, kind: "close", data: { coin, side, lev, size, pnl: (R() - 0.35) * size * 0.15 }, createdAt: time });
  }
  await prisma.activity.createMany({ data: acts });

  // Global chat history.
  await prisma.chatMessage.createMany({
    data: Array.from({ length: 14 }, (_, i) => ({
      userId: users[(i * 5) % users.length]!.user.id,
      text: CHAT[i % CHAT.length]!,
      createdAt: new Date(Date.now() - (14 - i) * 9e4),
    })),
  });

  console.log(`demo data: ${users.length} traders, 9 posts, ${funds.length} funds, ${acts.length} activity items, 14 chat messages` + (Object.keys(live).length ? " (live prices)" : " (reference prices)"));
}

async function main() {
  const purgeOnly = process.argv.includes("--purge-demo");
  if (purgeOnly) return purgeDemo();
  await seedInvites();
  if (process.env.SEED_DEMO === "true") {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data with NODE_ENV=production");
    await seedDemo();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
