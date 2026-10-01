import type { Prisma } from "@swellfi/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { cached, notFound, unauthorized } from "../lib/http";
import { startOfUtcDay, summarize, TF_DAYS, TIMEFRAMES, type StatRow, type Summary, type Timeframe } from "../lib/stats";
import { cursorSchema, handleSchema, limitSchema } from "../lib/validate";
import { serializeFund } from "./public";
import { publicUser, type PublicUser } from "./serialize";

const tfSchema = z.enum(TIMEFRAMES).default("7d");
const statSelect = { date: true, pnl: true, volume: true, equity: true, trades: true, closedTrades: true, wins: true } as const;

export interface LeaderRow extends Summary {
  rank: number;
  user: PublicUser;
  followers: number;
}

export async function socialRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma, redis } = ctx;

  async function followerCounts(ids: string[]) {
    const rows = await prisma.follow.groupBy({ by: ["followingId"], where: { followingId: { in: ids } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.followingId, r._count._all]));
  }

  async function followingSet(req: Parameters<AppContext["currentUser"]>[0], ids: string[]) {
    const me = await ctx.currentUser(req).catch(() => null);
    if (!me || !ids.length) return new Set<string>();
    const rows = await prisma.follow.findMany({ where: { followerId: me.id, followingId: { in: ids } }, select: { followingId: true } });
    return new Set(rows.map((r) => r.followingId));
  }

  /** Window of DailyStat rows needed to summarize a timeframe (incl. the day before and the sparkline). */
  const statsFrom = (tf: Timeframe) => {
    const days = TF_DAYS[tf];
    if (!Number.isFinite(days)) return undefined;
    return new Date(startOfUtcDay().getTime() - Math.max(days, 30) * 864e5);
  };

  async function leaderboard(tf: Timeframe): Promise<LeaderRow[]> {
    return cached(redis, `tl:lb:${tf}`, 60, async () => {
      const from = statsFrom(tf);
      const rows = await prisma.dailyStat.findMany({
        where: { user: { isPublic: true }, ...(from ? { date: { gte: from } } : {}) },
        select: { userId: true, ...statSelect },
      });
      const byUser = new Map<string, StatRow[]>();
      for (const r of rows) {
        const list = byUser.get(r.userId) ?? [];
        list.push(r);
        byUser.set(r.userId, list);
      }
      const ids = [...byUser.keys()];
      const [users, followers] = await Promise.all([prisma.user.findMany({ where: { id: { in: ids } } }), followerCounts(ids)]);
      return users
        .map((u) => ({ user: publicUser(u), followers: followers.get(u.id) ?? 0, ...summarize(byUser.get(u.id)!, tf) }))
        .sort((a, b) => Number(b.pnl) - Number(a.pnl))
        .map((r, i) => ({ rank: i + 1, ...r }));
    });
  }

  app.get("/leaderboard", async (req) => {
    const q = z.object({ tf: tfSchema, limit: limitSchema(200, 100) }).parse(req.query);
    const rows = (await leaderboard(q.tf)).slice(0, q.limit);
    const following = await followingSet(req, rows.map((r) => r.user.id));
    return { tf: q.tf, rows: rows.map((r) => ({ ...r, isFollowing: following.has(r.user.id) })) };
  });

  app.get("/activity", async (req) => {
    const q = z.object({ cursor: cursorSchema, limit: limitSchema(50, 20) }).parse(req.query);
    const items = await prisma.activity.findMany({
      where: { user: { isPublic: true } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { user: true },
    });
    const page = items.slice(0, q.limit);
    return {
      items: page.map((a) => ({ id: a.id, kind: a.kind, user: publicUser(a.user), data: a.data, createdAt: a.createdAt })),
      nextCursor: items.length > q.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get("/users/:handle", async (req) => {
    const { handle } = z.object({ handle: handleSchema }).parse(req.params);
    const user = await prisma.user.findUnique({ where: { handle }, include: { managedFund: { include: { manager: true }, take: 1 } } });
    if (!user || !user.isPublic) throw notFound("Trader not found");
    const [rows, followers, following, isFollowing] = await Promise.all([
      prisma.dailyStat.findMany({ where: { userId: user.id, date: { gte: new Date(startOfUtcDay().getTime() - 60 * 864e5) } }, select: statSelect }),
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      followingSet(req, [user.id]),
    ]);
    const s30 = summarize(rows, "30d");
    const all = summarize(rows, "all");
    const fund = user.managedFund[0];
    return {
      user: publicUser(user),
      followers,
      following,
      isFollowing: isFollowing.has(user.id),
      stats: { ...s30, series: all.series },
      fund: fund ? serializeFund(fund) : null,
    };
  });

  app.get("/users/:handle/stats", async (req) => {
    const { handle } = z.object({ handle: handleSchema }).parse(req.params);
    const { tf } = z.object({ tf: tfSchema }).parse(req.query);
    const user = await prisma.user.findUnique({ where: { handle } });
    if (!user || !user.isPublic) throw notFound("Trader not found");
    const from = statsFrom(tf);
    const rows = await prisma.dailyStat.findMany({ where: { userId: user.id, ...(from ? { date: { gte: from } } : {}) }, select: statSelect });
    return { tf, stats: summarize(rows, tf) };
  });

  app.get("/feed", async (req) => {
    const q = z.object({ scope: z.enum(["all", "following"]).default("all"), cursor: cursorSchema, limit: limitSchema(50, 20) }).parse(req.query);
    const me = await ctx.currentUser(req);
    let where: Prisma.PostWhereInput = { user: { isPublic: true } };
    if (q.scope === "following") {
      if (!me) throw unauthorized();
      const ids = (await prisma.follow.findMany({ where: { followerId: me.id }, select: { followingId: true } })).map((f) => f.followingId);
      where = { userId: { in: [...ids, me.id] } };
    }
    const posts = await prisma.post.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { user: true, ...(me ? { likedBy: { where: { userId: me.id }, select: { userId: true } } } : {}) },
    });
    const page = posts.slice(0, q.limit);
    const following = await followingSet(req, [...new Set(page.map((p) => p.userId))]);
    return {
      items: page.map((p) => ({
        id: p.id,
        user: publicUser(p.user),
        text: p.text,
        position: p.position,
        likes: p.likes,
        replies: p.replies,
        createdAt: p.createdAt,
        liked: "likedBy" in p && Array.isArray(p.likedBy) && p.likedBy.length > 0,
        mine: me?.id === p.userId,
        isFollowing: following.has(p.userId),
      })),
      nextCursor: posts.length > q.limit ? page[page.length - 1]!.id : null,
    };
  });

  /** Who to follow: top 7d traders the caller doesn't follow yet. */
  app.get("/suggestions", async (req) => {
    const rows = (await leaderboard("7d")).slice(0, 12);
    const me = await ctx.currentUser(req).catch(() => null);
    const following = await followingSet(req, rows.map((r) => r.user.id));
    return {
      traders: rows
        .filter((r) => r.user.id !== me?.id)
        .slice(0, 5)
        .map((r) => ({ user: r.user, roi7d: r.roi, isFollowing: following.has(r.user.id) })),
    };
  });

  app.get("/chat", async (req) => {
    const { limit } = z.object({ limit: limitSchema(100, 60) }).parse(req.query);
    const msgs = await prisma.chatMessage.findMany({ where: { deleted: false }, orderBy: { createdAt: "desc" }, take: limit, include: { user: true } });
    return { messages: msgs.reverse().map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt, user: publicUser(m.user) })) };
  });
}
