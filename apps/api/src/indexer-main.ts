import { createInfoClient, HL_ENDPOINTS } from "@swellfi/hl";
import { prisma } from "@swellfi/db";
import { Redis } from "ioredis";
import { loadEnv } from "./env";
import { cleanupExternal, pickTopTraders, setTopTraders, type LeaderboardRow } from "./indexer/external";
import { createIndexer, hlIndexerInfo } from "./indexer/indexer";
import { saveWhale, startWhaleWatcher } from "./indexer/whales";

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
  // Tests only: poll top traders sooner than every 2 minutes.
  ...(process.env.INDEXER_TOP_POLL_MS ? { topPollMs: Number(process.env.INDEXER_TOP_POLL_MS) } : {}),
});
console.log(`[indexer] ${network} via ${url}`);
const log = (m: string) => console.log(`${new Date().toISOString()} [indexer] ${m}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const every = (ms: number, fn: () => Promise<unknown>) => {
  const run = () => void fn().catch((e) => log(errText(e)));
  run();
  return setInterval(run, ms);
};

// Top traders: Hyperliquid's leaderboard (+ TOP_TRADERS), refreshed every 6 hours. A failed
// fetch keeps the current list rather than dropping everyone.
const LEADERBOARD = { mainnet: "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", testnet: "https://stats-data.hyperliquid-testnet.xyz/Testnet/leaderboard" };
const lbUrl = env.TOP_TRADERS_URL ?? LEADERBOARD[network];
const extra = env.TOP_TRADERS.split(",").map((a) => a.trim()).filter(Boolean);
const timers = [
  every(6 * 3600_000, async () => {
    let picked: string[] = [];
    if (lbUrl !== "off" && env.TOP_TRADERS_N > 0) {
      const res = await fetch(lbUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`leaderboard: HTTP ${res.status}`);
      const body = (await res.json()) as { leaderboardRows?: LeaderboardRow[] };
      if (!Array.isArray(body.leaderboardRows)) throw new Error("leaderboard: unexpected response");
      picked = pickTopTraders(body.leaderboardRows, env.TOP_TRADERS_N);
    }
    const r = await setTopTraders(prisma, [...picked, ...extra]);
    log(`top traders: following ${r.following}, dropped ${r.dropped}`);
  }),
  every(3600_000, async () => {
    const r = await cleanupExternal(prisma);
    if (r.whales + r.events + r.fills + r.users) log(`cleanup: ${JSON.stringify(r)}`);
  }),
];

// Whale trades from the public trades feed of the most traded markets.
const wsUrl = env.WHALE_WS_URL || (dataNetwork === network && env.NEXT_PUBLIC_HL_WS_URL) || HL_ENDPOINTS[network].ws;
const MAJORS = new Set(["BTC", "ETH"]);
const whales =
  env.WHALES === "off"
    ? null
    : startWhaleWatcher({
        url: wsUrl,
        minUsd: (coin) => (MAJORS.has(coin) ? env.WHALE_MIN_USD_MAJOR : env.WHALE_MIN_USD),
        async coins() {
          const [meta, ctxs] = await client.post<[{ universe: { name: string; isDelisted?: boolean }[] }, { dayNtlVlm?: string }[]]>({ type: "metaAndAssetCtxs" });
          return meta.universe
            .map((u, i) => ({ name: u.name, vlm: Number(ctxs[i]?.dayNtlVlm ?? 0), delisted: u.isDelisted }))
            .filter((u) => !u.delisted)
            .sort((a, b) => b.vlm - a.vlm)
            .slice(0, env.WHALE_COINS)
            .map((u) => u.name);
        },
        onWhale: (w) => saveWhale(prisma, redis, w),
        log,
      });

const shutdown = async (signal: string) => {
  console.log(`[indexer] ${signal}: stopping`);
  indexer.stop();
  whales?.stop();
  for (const t of timers) clearInterval(t);
  setTimeout(async () => {
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  }, 500);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await indexer.run();
