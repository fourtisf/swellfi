import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@tideline/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { badRequest, HttpError, unauthorized } from "../lib/http";
import { tierIndexFor } from "../lib/rewards";
import { startOfUtcDay } from "../lib/stats";
import { addressSchema, coinSchema, inviteCodeSchema } from "../lib/validate";
import { publicUser } from "./serialize";

const MAX_WATCH = 100;
const DEFAULT_WATCHLIST = ["BTC", "ETH", "HYPE", "SOL", "xyz:SP500"];
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const randomCode = (n: number) => [...randomBytes(n)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

async function uniqueHandle(tx: Prisma.TransactionClient | PrismaClient, address: string) {
  const base = `trader_${address.slice(2, 8).toLowerCase()}`;
  for (let i = 0; i < 20; i++) {
    const h = i ? `${base}${randomCode(2)}` : base;
    if (!(await tx.user.findUnique({ where: { handle: h }, select: { id: true } }))) return h;
  }
  throw new HttpError(500, "HANDLE_EXHAUSTED");
}

export async function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma, env } = ctx;

  /** Who am I? 404 NOT_REGISTERED means: logged in with Privy but no invite redeemed yet. */
  app.get("/me", async (req, reply) => {
    const id = await ctx.identify(req);
    if (!id) throw unauthorized();
    const user = await ctx.currentUser(req);
    if (!user) return reply.status(404).send({ error: "NOT_REGISTERED", inviteOnly: env.INVITE_ONLY });
    return {
      user: { ...publicUser(user), referralCode: user.referralCode, isPublic: user.isPublic },
      isAdmin: ctx.isAdmin(user),
      referralLink: `${env.APP_URL}/r/${user.referralCode}`,
    };
  });

  /**
   * Finish sign-up: redeem an invite (required while INVITE_ONLY), accept the terms and
   * bind the master wallet. The wallet must be linked to the caller's Privy account.
   */
  app.post("/invite/redeem", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const id = await ctx.identify(req);
    if (!id) throw unauthorized();
    const body = z
      .object({
        code: inviteCodeSchema.optional(),
        address: addressSchema.transform((a) => a.toLowerCase()),
        acceptTerms: z.literal(true, { errorMap: () => ({ message: "You need to accept the terms" }) }),
        ref: z.string().trim().max(32).optional(),
      })
      .parse(req.body);

    const existing = await prisma.user.findUnique({ where: { privyId: id.privyId } });
    if (existing) return { user: publicUser(existing), created: false };

    const wallets = await ctx.auth.linkedWallets(id.privyId);
    if (!wallets.includes(body.address)) throw badRequest("WALLET_NOT_LINKED", "That wallet isn't linked to your login");
    if (env.INVITE_ONLY && !body.code) throw badRequest("INVITE_REQUIRED", "An invite code is required");

    const user = await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { address: body.address }, select: { id: true } })) {
        throw new HttpError(409, "WALLET_TAKEN", "That wallet already has an account");
      }
      if (body.code) {
        const used = await tx.inviteCode.updateMany({
          where: {
            code: body.code,
            uses: { lt: tx.inviteCode.fields.maxUses },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          data: { uses: { increment: 1 } },
        });
        if (used.count === 0) throw badRequest("INVALID_INVITE", "That invite code is invalid or used up");
      }
      const referrer = body.ref ? await tx.user.findUnique({ where: { referralCode: body.ref }, select: { id: true } }) : null;
      const created = await tx.user.create({
        data: {
          privyId: id.privyId,
          address: body.address,
          handle: await uniqueHandle(tx, body.address),
          referralCode: randomCode(8),
          referredById: referrer?.id ?? null,
          inviteCode: body.code ?? null,
          termsAcceptedAt: new Date(),
        },
      });
      if (body.code) await tx.inviteCode.update({ where: { code: body.code }, data: { usedById: created.id, usedAt: new Date() } });
      await tx.watchItem.createMany({ data: DEFAULT_WATCHLIST.map((coin) => ({ userId: created.id, coin })) });
      return created;
    });
    return { user: publicUser(user), created: true };
  });

  app.post("/waitlist", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email().max(254),
        xHandle: z
          .string()
          .trim()
          .max(32)
          .transform((s) => s.replace(/^@/, ""))
          .refine((s) => s === "" || /^[A-Za-z0-9_]{1,15}$/.test(s), "Invalid X handle")
          .optional(),
      })
      .parse(req.body);
    await prisma.waitlistEntry.upsert({
      where: { email: body.email },
      update: body.xHandle ? { xHandle: body.xHandle } : {},
      create: { email: body.email, xHandle: body.xHandle || null },
    });
    // Same answer whether or not the email was already on the list.
    return { ok: true };
  });

  app.get("/watchlist", async (req) => {
    const user = await ctx.requireUser(req);
    const items = await prisma.watchItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    return { coins: items.map((i) => i.coin) };
  });

  app.post("/watchlist", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const body = z.object({ coin: coinSchema, starred: z.boolean() }).parse(req.body);
    if (body.starred) {
      const count = await prisma.watchItem.count({ where: { userId: user.id } });
      if (count >= MAX_WATCH) throw badRequest("WATCHLIST_FULL", `Watchlist is limited to ${MAX_WATCH} markets`);
      await prisma.watchItem.upsert({
        where: { userId_coin: { userId: user.id, coin: body.coin } },
        update: {},
        create: { userId: user.id, coin: body.coin },
      });
    } else {
      await prisma.watchItem.deleteMany({ where: { userId: user.id, coin: body.coin } });
    }
    const items = await prisma.watchItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    return { coins: items.map((i) => i.coin) };
  });

  app.get("/rewards", async (req) => {
    const user = await ctx.requireUser(req);
    const since = new Date(startOfUtcDay().getTime() - 29 * 864e5);
    const [mine, invited, claimable, refEarned] = await Promise.all([
      prisma.dailyStat.aggregate({ where: { userId: user.id, date: { gte: since } }, _sum: { volume: true } }),
      prisma.user.findMany({ where: { referredById: user.id }, select: { id: true } }),
      prisma.rewardLedger.aggregate({ where: { userId: user.id, claimedAt: null }, _sum: { amount: true } }),
      prisma.rewardLedger.aggregate({ where: { userId: user.id, kind: "referral" }, _sum: { amount: true } }),
    ]);
    const theirs = invited.length
      ? await prisma.dailyStat.aggregate({ where: { userId: { in: invited.map((u) => u.id) }, date: { gte: since } }, _sum: { volume: true } })
      : null;
    const volume30d = (mine._sum.volume ?? new Prisma.Decimal(0)).toNumber();
    return {
      tiers: ctx.tiers,
      tierIndex: tierIndexFor(ctx.tiers, volume30d),
      volume30d: volume30d.toFixed(2),
      claimable: (claimable._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      referral: {
        link: `${env.APP_URL}/r/${user.referralCode}`,
        invited: invited.length,
        theirVolume30d: (theirs?._sum.volume ?? new Prisma.Decimal(0)).toFixed(2),
        earned: (refEarned._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      },
    };
  });

  /** Tiers are public so logged-out visitors see the rewards page. */
  app.get("/rewards/tiers", async () => ({ tiers: ctx.tiers }));
}
