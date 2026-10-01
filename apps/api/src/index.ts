import { prisma } from "@tideline/db";
import { Redis } from "ioredis";
import { buildApp } from "./app";
import { loadEnv } from "./env";
import { createPrivyVerifier } from "./lib/auth";

const env = loadEnv();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false });
redis.on("error", (err) => console.error("[redis]", err.message));

const app = await buildApp({
  env,
  prisma,
  redis,
  auth: createPrivyVerifier(env.NEXT_PUBLIC_PRIVY_APP_ID, env.PRIVY_APP_SECRET, env.PRIVY_VERIFICATION_KEY),
});

if (!env.NEXT_PUBLIC_PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
  app.log.info("Privy is not configured: wallet sign-in (MetaMask, Rabby, …) only, no email login");
}

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  app.log.info(`${signal}: shutting down`);
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.API_PORT, host: env.API_HOST });
