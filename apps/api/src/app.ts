import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import type { PrismaClient, User } from "@swellfi/db";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import type { Env } from "./env";
import type { AuthIdentity, AuthVerifier } from "./lib/auth";
import { errorHandler, forbidden, unauthorized } from "./lib/http";
import { loadTiers, type Tier } from "./lib/rewards";
import { accountRoutes } from "./routes/account";
import { adminRoutes } from "./routes/admin";
import { feedRoutes } from "./routes/feed";
import { profileRoutes } from "./routes/profile";
import { authRoutes } from "./routes/auth";
import { withWalletSessions } from "./lib/wallet-auth";
import { publicRoutes } from "./routes/public";
import { socialRoutes } from "./routes/social";
import { gateway } from "./ws/gateway";

export interface AppDeps {
  env: Env;
  prisma: PrismaClient;
  redis: Redis;
  auth: AuthVerifier;
  logger?: boolean | object;
}

export interface AppContext extends AppDeps {
  tiers: Tier[];
  /** Verified caller identity, or null for anonymous requests. Throws on a bad token. */
  identify(req: FastifyRequest): Promise<AuthIdentity | null>;
  /** Registered user for the caller, or null. */
  currentUser(req: FastifyRequest): Promise<User | null>;
  /** 401 without a token, 403 NOT_REGISTERED without an account. */
  requireUser(req: FastifyRequest): Promise<User>;
  isAdmin(user: User): boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    _identity?: Promise<AuthIdentity | null>;
    _user?: Promise<User | null>;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env, prisma, redis } = deps;
  // Wallet sign-in sessions work everywhere; Privy tokens are accepted when Privy is configured.
  const auth = withWalletSessions(deps.auth, env.SESSION_SECRET);
  const app = Fastify({
    logger: deps.logger ?? (env.NODE_ENV === "development" ? { transport: { target: "pino-pretty" } } : env.NODE_ENV !== "test"),
    // Only the local reverse proxy (nginx on this host) may set the client IP. Trusting every hop
    // would let a client pick its own IP with X-Forwarded-For and dodge every rate limit.
    trustProxy: env.TRUST_PROXY ? "loopback" : false,
    bodyLimit: 64 * 1024,
  });

  const ctx: AppContext = {
    ...deps,
    auth,
    tiers: loadTiers(env.REWARD_TIERS_JSON),
    identify(req) {
      if (!req._identity) {
        const h = req.headers.authorization;
        const token = h?.startsWith("Bearer ") ? h.slice(7).trim() : "";
        req._identity = token
          ? auth.verify(token).catch((e) => {
              req.log.debug({ err: e }, "token rejected");
              throw unauthorized();
            })
          : Promise.resolve(null);
      }
      return req._identity;
    },
    currentUser(req) {
      if (!req._user) {
        req._user = ctx.identify(req).then((id) => (id ? prisma.user.findUnique({ where: { privyId: id.privyId } }) : null));
      }
      return req._user;
    },
    async requireUser(req) {
      const id = await ctx.identify(req);
      if (!id) throw unauthorized();
      const user = await ctx.currentUser(req);
      if (!user) throw forbidden("NOT_REGISTERED", "Redeem an invite to finish signing up");
      return user;
    },
    isAdmin: (user) => env.ADMIN_ADDRESSES.includes(user.address.toLowerCase()),
  };

  app.setErrorHandler(errorHandler);
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await app.register(cors, { origin: [env.APP_URL], methods: ["GET", "POST", "DELETE"], maxAge: 600 });
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    redis,
    nameSpace: "tl:rl:",
    skipOnError: true,
  });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  await app.register(
    async (api) => {
      await authRoutes(api, ctx);
      await publicRoutes(api, ctx);
      await socialRoutes(api, ctx);
      await accountRoutes(api, ctx);
      await profileRoutes(api, ctx);
      await feedRoutes(api, ctx);
      await adminRoutes(api, ctx);
    },
    { prefix: "/api" },
  );
  await app.register(async (ws) => gateway(ws, ctx));

  return app;
}
