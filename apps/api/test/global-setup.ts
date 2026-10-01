import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Integration tests run against a throwaway database (TEST_DATABASE_URL) and Redis db 15. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://tideline:tideline@localhost:5432/tideline_test?schema=public";
  process.env.TEST_DATABASE_URL = url;
  const dbDir = fileURLToPath(new URL("../../../packages/db", import.meta.url));
  execSync("pnpm exec prisma migrate deploy", { cwd: dbDir, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
