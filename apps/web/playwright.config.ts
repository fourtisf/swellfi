import { defineConfig } from "@playwright/test";

// Smoke tests against a running stack: mock Hyperliquid (pnpm mock:hl), API and web.
// Build the web app with NEXT_PUBLIC_HL_INFO_URL / NEXT_PUBLIC_HL_WS_URL pointing at the mock.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
