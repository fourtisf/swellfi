import type { Prisma } from "@swellfi/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { forbidden, notFound, unauthorized } from "../lib/http";
import { cursorSchema, limitSchema } from "../lib/validate";
import { publicUser } from "./serialize";

const KINDS: Record<string, string[] | undefined> = { all: undefined, trades: ["open", "close"], open: ["open"], close: ["close"] };
const idSchema = z.string().min(1).max(200);
const SYNC_WINDOW_MS = 10_000;

// ---------------------------------------------------------------- news (RSS)
export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

const DEFAULT_FEEDS = "CoinDesk|https://www.coindesk.com/arc/outboundfeeds/rss/,Decrypt|https://decrypt.co/feed,Cointelegraph|https://cointelegraph.com/rss";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();

/** Minimal RSS 2.0 / Atom reader: title, link and date of each item, as plain text. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const block = m[0];
    const tag = (name: string) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1];
    const title = decode(tag("title") ?? "");
    let link = decode(tag("link") ?? "");
    if (!link) link = /<link\b[^>]*href="([^"]+)"/i.exec(block)?.[1] ?? "";
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    // Only plain https links end up as hrefs.
    if (url.protocol !== "https:" || !title) continue;
    const date = decode(tag("pubDate") ?? tag("published") ?? tag("updated") ?? "");
    const t = Date.parse(date);
    out.push({ title: title.slice(0, 200), url: url.toString(), source, publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return out;
}

async function fetchFeed(url: string, source: string): Promise<NewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Swellfi news (+https://swellfi.xyz)", Accept: "application/rss+xml, application/xml, text/xml" }, redirect: "follow" });
    if (!res.ok) return [];
    const text = (await res.text()).slice(0, 2_000_000);
    return parseFeed(text, source);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function feedRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma, redis } = ctx;

  /** Live activity: trades (opened/closed, from the indexer) and other events, newest first. */
  app.get("/activity", async (req) => {
    const q = z
      .object({ scope: z.enum(["global", "following"]).default("global"), kind: z.enum(["all", "trades", "open", "close"]).default("all"), cursor: cursorSchema, limit: limitSchema(50, 20) })
      .parse(req.query);
    const me = await ctx.currentUser(req).catch(() => null);
    const where: Prisma.ActivityWhereInput = { user: { isPublic: true } };
    const kinds = KINDS[q.kind];
    if (kinds) where.kind = { in: kinds };
    if (q.scope === "following") {
      if (!me) throw unauthorized();
      const ids = (await prisma.follow.findMany({ where: { followerId: me.id }, select: { followingId: true } })).map((f) => f.followingId);
      // Public accounts you follow, plus your own (even if private).
      delete where.user;
      where.OR = [{ userId: me.id }, { userId: { in: ids }, user: { isPublic: true } }];
    }
    const items = await prisma.activity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { user: true, ...(me ? { likedBy: { where: { userId: me.id }, select: { userId: true } } } : {}) },
    });
    const page = items.slice(0, q.limit);
    const authors = [...new Set(page.map((a) => a.userId))];
    const follows = me && authors.length ? new Set((await prisma.follow.findMany({ where: { followerId: me.id, followingId: { in: authors } }, select: { followingId: true } })).map((f) => f.followingId)) : new Set<string>();
    return {
      items: page.map((a) => ({
        id: a.id,
        kind: a.kind,
        user: publicUser(a.user),
        data: a.data,
        createdAt: a.createdAt,
        likes: a.likes,
        liked: "likedBy" in a && Array.isArray(a.likedBy) && a.likedBy.length > 0,
        mine: me?.id === a.userId,
        isFollowing: follows.has(a.userId),
      })),
      nextCursor: items.length > q.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.post("/activity/:id/like", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const a = await prisma.activity.findUnique({ where: { id }, include: { user: { select: { isPublic: true } } } });
    if (!a || (!a.user.isPublic && a.userId !== user.id)) throw notFound("Activity not found");
    const likes = await prisma.$transaction(async (tx) => {
      const r = await tx.activityLike.createMany({ data: [{ userId: user.id, activityId: id }], skipDuplicates: true });
      if (!r.count) return a.likes;
      return (await tx.activity.update({ where: { id }, data: { likes: { increment: 1 } }, select: { likes: true } })).likes;
    });
    return { likes, liked: true };
  });

  app.delete("/activity/:id/like", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const { id } = z.object({ id: idSchema }).parse(req.params);
    const likes = await prisma.$transaction(async (tx) => {
      const r = await tx.activityLike.deleteMany({ where: { userId: user.id, activityId: id } });
      const a = r.count
        ? await tx.activity.update({ where: { id }, data: { likes: { decrement: 1 } }, select: { likes: true } })
        : await tx.activity.findUnique({ where: { id }, select: { likes: true } });
      if (!a) throw notFound("Activity not found");
      return Math.max(0, a.likes);
    });
    return { likes, liked: false };
  });

  const follow = (on: boolean) => async (req: Parameters<AppContext["requireUser"]>[0]) => {
    const user = await ctx.requireUser(req);
    const { id } = z.object({ id: idSchema }).parse(req.params);
    if (id === user.id) throw forbidden("SELF_FOLLOW", "You can't follow yourself");
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, isPublic: true } });
    if (!target || !target.isPublic) throw notFound("Trader not found");
    if (on) await prisma.follow.createMany({ data: [{ followerId: user.id, followingId: id }], skipDuplicates: true });
    else await prisma.follow.deleteMany({ where: { followerId: user.id, followingId: id } });
    await redis.del("tl:lb:24h", "tl:lb:7d", "tl:lb:30d", "tl:lb:all").catch(() => {});
    return { following: on, followers: await prisma.follow.count({ where: { followingId: id } }) };
  };
  app.post("/users/:id/follow", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, follow(true));
  app.delete("/users/:id/follow", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, follow(false));

  /** The app saw a new fill on Hyperliquid: ask the indexer to look at this account now. */
  // Limited per account, not per IP (people on one mobile carrier or office network share an IP;
  // the IP limit only stops abuse). The first call in a 10 s window polls now; later ones are
  // deferred to the end of the window, never dropped, so an account is polled at most ~6x/min.
  app.post("/me/sync", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const first = await redis.set(`tl:sync:${user.id}`, "1", "PX", SYNC_WINDOW_MS, "NX").catch(() => "OK");
    const at = first ? new Date() : new Date(Date.now() + SYNC_WINDOW_MS);
    await prisma.indexState.upsert({ where: { userId: user.id }, create: { userId: user.id, nextPollAt: at }, update: { nextPollAt: at, idleStreak: 0 } });
    return { ok: true };
  });

  /** Crypto headlines from a few RSS feeds (fixed list, cached for 10 minutes). */
  app.get("/news", async () => {
    const hit = await redis.get("tl:news").catch(() => null);
    if (hit) return JSON.parse(hit) as { items: NewsItem[] };
    {
      const feeds = (ctx.env.NEWS_FEEDS ?? DEFAULT_FEEDS)
        .split(",")
        .map((s) => s.trim().split("|"))
        .filter((p): p is [string, string] => p.length === 2 && p[1]!.startsWith("http"));
      const all = (await Promise.all(feeds.map(([name, url]) => fetchFeed(url, name)))).flat();
      const seen = new Set<string>();
      const items = all
        .filter((n) => !seen.has(n.url) && (seen.add(n.url), true))
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
        .slice(0, 10);
      // Keep a failed fetch only briefly so the panel comes back soon.
      await redis.set("tl:news", JSON.stringify({ items }), "EX", items.length ? 600 : 60).catch(() => {});
      return { items };
    }
  });
}
