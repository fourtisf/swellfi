import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export { Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __tidelinePrisma?: PrismaClient };

/** One PrismaClient per process (survives hot reload in dev). */
export const prisma: PrismaClient =
  globalForPrisma.__tidelinePrisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__tidelinePrisma = prisma;
