import { Prisma, PrismaClient } from "@swellfi/db";
import { Redis } from "ioredis";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import type { AuthVerifier } from "../src/lib/auth";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://swellfi:swellfi@localhost:5432/swellfi_test?schema=public";

/** Fake Privy: token "tok:<privyId>" is valid; wallets are registered per privyId. */
export function fakeAuth(wallets: Record<string, string[]> = {}): AuthVerifier & { wallets: Record<string, string[]> } {
  return {
    wallets,
    async verify(token) {
      if (!token.startsWith("tok:")) throw new Error("bad token");
      return { privyId: token.slice(4) };
    },
    async linkedWallets(privyId) {
      return (wallets[privyId] ?? []).map((a) => a.toLowerCase());
    },
  };
}

export async function setupTestApp(envOverrides: Record<string, string> = {}) {
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15");
  await redis.flushdb();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  const auth = fakeAuth();
  const env = loadEnv({
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB,
    INVITE_ONLY: "true",
    ADMIN_ADDRESSES: "0x00000000000000000000000000000000000000ad",
    RATE_LIMIT_MAX: "1000",
    ...envOverrides,
  });
  const app = await buildApp({ env, prisma, redis, auth, logger: false });
  await app.ready();
  return {
    app,
    prisma,
    redis,
    auth,
    async close() {
      await app.close();
      await prisma.$disconnect();
      redis.disconnect();
    },
  };
}

export const D = (n: number) => new Prisma.Decimal(n);
export const bearer = (privyId: string) => ({ authorization: `Bearer tok:${privyId}` });
