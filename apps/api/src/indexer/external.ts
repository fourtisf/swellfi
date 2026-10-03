import type { Prisma, PrismaClient } from "@swellfi/db";

/**
 * Hyperliquid addresses that aren't Swellfi members but show up in the feed: leaderboard
 * traders the indexer follows ("top") and whale takers ("external"). They have a placeholder
 * privyId that no login can produce, and become members when the owner signs up.
 */

const ADDRESS = /^0x[0-9a-f]{40}$/;

type Tx = PrismaClient | Prisma.TransactionClient;

async function externalHandle(tx: Tx, address: string) {
  for (const n of [6, 8, 12, 40]) {
    const h = `hl_${address.slice(2, 2 + n)}`;
    if (!(await tx.user.findUnique({ where: { handle: h }, select: { id: true } }))) return h;
  }
  throw new Error(`no free handle for ${address}`);
}

/** The user row for a Hyperliquid address, created as `kind` if it doesn't exist yet. */
export async function externalUser(prisma: PrismaClient, address: string, kind: "top" | "external") {
  const a = address.toLowerCase();
  if (!ADDRESS.test(a)) throw new Error(`bad address ${address}`);
  const found = await prisma.user.findUnique({ where: { address: a } });
  if (found) return found;
  try {
    return await prisma.user.create({
      data: { privyId: `hl:${a}`, address: a, kind, handle: await externalHandle(prisma, a), referralCode: `x${a.slice(2)}` },
    });
  } catch (e) {
    // Created concurrently (whale watcher and top-trader sync): use that row.
    const again = await prisma.user.findUnique({ where: { address: a } });
    if (again) return again;
    throw e;
  }
}

// ------------------------------------------------------------------ top traders

type Perf = { pnl?: string | number; roi?: string | number; vlm?: string | number };
export interface LeaderboardRow {
  ethAddress: string;
  accountValue: string | number;
  windowPerformances: [string, Perf][];
}

/**
 * Pick the traders worth following from Hyperliquid's leaderboard: profitable this month and
 * all time, a real account (>= $50K), and not a market maker or HFT (monthly volume over 200x
 * the account: thousands of tiny orders that would flood the feed). Best monthly PnL first.
 */
export function pickTopTraders(rows: LeaderboardRow[], n: number): string[] {
  const out: { address: string; pnl: number }[] = [];
  for (const r of rows) {
    const address = String(r?.ethAddress ?? "").toLowerCase();
    if (!ADDRESS.test(address) || !Array.isArray(r.windowPerformances)) continue;
    const perf = (w: string) => r.windowPerformances.find((p) => p?.[0] === w)?.[1] ?? {};
    const month = perf("month");
    const all = perf("allTime");
    const value = Number(r.accountValue);
    const pnl = Number(month.pnl);
    const vlm = Number(month.vlm);
    if (!(value >= 50_000) || !(pnl > 0) || !(Number(all.pnl) > 0) || !(vlm / value <= 200)) continue;
    out.push({ address, pnl });
  }
  return out
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, n)
    .map((t) => t.address);
}

/**
 * Make exactly these addresses (plus `extra`) the followed top traders. Members stay members;
 * traders that dropped off the list become "external" (their events stay, polling stops).
 */
export async function setTopTraders(prisma: PrismaClient, addresses: string[]) {
  const want = [...new Set(addresses.map((a) => a.toLowerCase()).filter((a) => ADDRESS.test(a)))];
  for (const a of want) {
    const u = await externalUser(prisma, a, "top");
    if (u.kind === "external") await prisma.user.update({ where: { id: u.id }, data: { kind: "top" } });
  }
  const dropped = await prisma.user.updateMany({ where: { kind: "top", address: { notIn: want } }, data: { kind: "external" } });
  return { following: want.length, dropped: dropped.count };
}

// ------------------------------------------------------------------ cleanup

const DAY = 864e5;

/** Keep the external side small: a few days of whale trades and fills, nothing orphaned. */
export async function cleanupExternal(prisma: PrismaClient, now = Date.now()) {
  const ext = { kind: { in: ["top", "external"] } };
  const whales = await prisma.activity.deleteMany({ where: { kind: "whale", createdAt: { lt: new Date(now - 3 * DAY) } } });
  const events = await prisma.activity.deleteMany({ where: { user: ext, kind: { in: ["open", "close"] }, createdAt: { lt: new Date(now - 7 * DAY) } } });
  const fills = await prisma.fill.deleteMany({ where: { user: ext, time: { lt: new Date(now - 3 * DAY) } } });
  const users = await prisma.user.deleteMany({ where: { kind: "external", activity: { none: {} }, followers: { none: {} } } });
  return { whales: whales.count, events: events.count, fills: fills.count, users: users.count };
}
