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
  NEXT_PUBLIC_HL_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEXT_PUBLIC_BRAND_NAME: z.string().default("Tideline"),
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
  return parsed.data;
}
