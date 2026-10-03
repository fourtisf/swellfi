import { randomBytes } from "node:crypto";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default("127.0.0.1"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().default(""),
  PRIVY_APP_SECRET: z.string().default(""),
  PRIVY_VERIFICATION_KEY: z.string().default(""),
  /** HMAC secret for wallet sign-in sessions (≥ 32 chars). Required in production. */
  SESSION_SECRET: z.string().default(""),
  NEXT_PUBLIC_HL_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEXT_PUBLIC_HL_DATA_NETWORK: z.string().optional(),
  NEXT_PUBLIC_HL_INFO_URL: z.string().optional(),
  NEXT_PUBLIC_HL_HIP3_DEXES: z.string().default(""),
  /** Indexer: Hyperliquid /info URL override (else the trading network's public API). */
  INDEXER_INFO_URL: z.string().optional(),
  /** Indexer: max Hyperliquid info requests per minute (each costs ~20 of the 1200/min IP budget). */
  INDEXER_RPM: z.coerce.number().int().min(1).default(40),
  NEXT_PUBLIC_HL_WS_URL: z.string().optional(),
  /** Top traders the feed follows: Hyperliquid's leaderboard JSON ("off" to disable; defaults per network). */
  TOP_TRADERS_URL: z.string().optional(),
  /** How many leaderboard traders to follow (each costs about one request per 2 minutes). */
  TOP_TRADERS_N: z.coerce.number().int().min(0).max(100).default(20),
  /** Extra addresses to follow as top traders, comma separated. */
  TOP_TRADERS: z.string().default(""),
  /** Whale trades in the feed: "off" to disable. Taker orders of at least this many USD. */
  WHALES: z.string().default("on"),
  WHALE_MIN_USD: z.coerce.number().min(1000).default(250_000),
  /** Threshold for BTC and ETH. */
  WHALE_MIN_USD_MAJOR: z.coerce.number().min(1000).default(1_000_000),
  /** Markets watched for whale trades: the most traded N of the main dex. */
  WHALE_COINS: z.coerce.number().int().min(1).max(200).default(40),
  /** WebSocket override for whale trades (else the trading network's public WS). */
  WHALE_WS_URL: z.string().optional(),
  /** News panel sources: "Name|https://feed,Name|https://feed". Defaults to CoinDesk, Decrypt, Cointelegraph. */
  NEWS_FEEDS: z.string().optional(),
  NEXT_PUBLIC_BRAND_NAME: z.string().default("Swellfi"),
  INVITE_ONLY: bool.default("true"),
  ADMIN_ADDRESSES: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
    ),
  REWARD_TIERS_JSON: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  TRUST_PROXY: bool.default("true"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${msg}`);
  }
  const env = parsed.data;
  if (env.SESSION_SECRET.length < 32) {
    if (env.NODE_ENV === "production") throw new Error("Invalid environment:\n  SESSION_SECRET: must be at least 32 characters");
    // Dev/test: a per-process secret (wallet sessions end when the API restarts).
    env.SESSION_SECRET = randomBytes(32).toString("hex");
  }
  return env;
}
