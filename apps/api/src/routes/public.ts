import { Prisma } from "@swellfi/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { cached, notFound } from "../lib/http";
import { startOfUtcDay } from "../lib/stats";
import { publicUser } from "./serialize";

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma, redis, env } = ctx;

  app.get("/health", { config: { rateLimit: false } }, async () => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    return { ok: db.status === "fulfilled", db: db.status === "fulfilled", redis: cache.status === "fulfilled" };
  });

  /** Public runtime config the web app needs before login. */
  app.get("/config", async () => ({
    brand: env.NEXT_PUBLIC_BRAND_NAME,
    inviteOnly: env.INVITE_ONLY,
    network: env.NEXT_PUBLIC_HL_NETWORK,
    privy: Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID && env.PRIVY_APP_SECRET),
  }));

  /** Platform stats: users, TVL (sum of latest account values), volume, trades. */
  app.get("/stats", async () =>
    cached(redis, "tl:stats", 30, async () => {
      const [users, totals, tvl] = await Promise.all([
        prisma.user.count(),
        prisma.dailyStat.aggregate({ _sum: { volume: true, trades: true } }),
        prisma.$queryRaw<{ tvl: Prisma.Decimal | null }[]>`
          SELECT SUM(d.equity) AS tvl FROM "DailyStat" d
          JOIN (SELECT "userId", MAX(date) AS date FROM "DailyStat" GROUP BY "userId") last
            ON last."userId" = d."userId" AND last.date = d.date`,
      ]);
      return {
        users,
        tvl: (tvl[0]?.tvl ?? new Prisma.Decimal(0)).toFixed(2),
        volume: (totals._sum.volume ?? new Prisma.Decimal(0)).toFixed(2),
        trades: totals._sum.trades ?? 0,
        asOf: new Date().toISOString(),
      };
    }),
  );

  /** ⌘K trader search. */
  app.get("/search", async (req) => {
    const { q } = z.object({ q: z.string().trim().max(32).default("") }).parse(req.query);
    const users = await prisma.user.findMany({
      where: { isPublic: true, ...(q ? { handle: { contains: q.toLowerCase() } } : {}) },
      orderBy: { followers: { _count: "desc" } },
      take: q ? 6 : 4,
    });
    return { traders: users.map(publicUser) };
  });

  app.get("/funds", async () =>
    cached(redis, "tl:funds", 60, async () => {
      const funds = await prisma.fund.findMany({ include: { manager: true }, orderBy: { aum: "desc" } });
      return { funds: funds.map(serializeFund) };
    }),
  );

  app.get("/funds/:id", async (req) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const fund = await prisma.fund.findUnique({ where: { id }, include: { manager: true } });
    if (!fund) throw notFound("Fund not found");
    return { fund: serializeFund(fund) };
  });

  /** Today's tape for the "Live on" card. */
  app.get("/activity/summary", async () =>
    cached(redis, "tl:act:sum", 30, async () => {
      const today = startOfUtcDay();
      const [vol, traders, recent] = await Promise.all([
        prisma.dailyStat.aggregate({ where: { date: today }, _sum: { volume: true } }),
        prisma.dailyStat.count({ where: { date: today, trades: { gt: 0 } } }),
        prisma.activity.findMany({
          where: { kind: { in: ["open", "close"] }, createdAt: { gte: new Date(Date.now() - 864e5) } },
          select: { data: true },
          take: 2000,
        }),
      ]);
      const counts = new Map<string, number>();
      for (const a of recent) {
        const coin = (a.data as { coin?: string }).coin;
        if (coin) counts.set(coin, (counts.get(coin) ?? 0) + 1);
      }
      const topCoin = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { volumeToday: (vol._sum.volume ?? new Prisma.Decimal(0)).toFixed(2), topCoin, tradersToday: traders };
    }),
  );
}

type FundWithManager = Prisma.FundGetPayload<{ include: { manager: true } }>;

export function serializeFund(f: FundWithManager) {
  return {
    id: f.id,
    name: f.name,
    vaultAddress: f.vaultAddress,
    strategy: f.strategy,
    manager: publicUser(f.manager),
    perfFeePct: f.perfFeePct.toNumber(),
    risk: f.risk,
    minDeposit: f.minDeposit.toFixed(2),
    aum: f.aum.toFixed(2),
    members: f.members,
    return30d: f.return30d.toNumber(),
    maxDrawdown: f.maxDrawdown.toNumber(),
    series: f.series as number[],
  };
}
