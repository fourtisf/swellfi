import { createInfoClient, HL_ENDPOINTS } from "@swellfi/hl";
import { prisma } from "@swellfi/db";
import { Redis } from "ioredis";
import { loadEnv } from "./env";
import { createIndexer, hlIndexerInfo } from "./indexer/indexer";

// Indexer worker (PM2 app "swellfi-indexer"): Hyperliquid fills -> Fill, Activity, DailyStat.
const env = loadEnv();
const network = env.NEXT_PUBLIC_HL_NETWORK;
// NEXT_PUBLIC_HL_INFO_URL may point at the market-data network; only use it when that's the trading network.
const dataNetwork = env.NEXT_PUBLIC_HL_DATA_NETWORK || network;
const url = env.INDEXER_INFO_URL || (dataNetwork === network && env.NEXT_PUBLIC_HL_INFO_URL) || `${HL_ENDPOINTS[network].api}/info`;

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
redis.on("error", (err) => console.error("[redis]", err.message));
const client = createInfoClient({ url, retries: 2, timeoutMs: 15_000 });
const indexer = createIndexer({
  prisma,
  redis,
  info: hlIndexerInfo(client.post),
  dexes: env.NEXT_PUBLIC_HL_HIP3_DEXES.split(",").map((d) => d.trim()).filter(Boolean),
  rpm: env.INDEXER_RPM,
  debug: process.env.INDEXER_DEBUG === "1",
});
console.log(`[indexer] ${network} via ${url}`);

const shutdown = async (signal: string) => {
  console.log(`[indexer] ${signal}: stopping`);
  indexer.stop();
  setTimeout(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }, 500);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await indexer.run();
