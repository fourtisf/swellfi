import { expect, test } from "@playwright/test";

// The feed beyond Swellfi members: whale trades from Hyperliquid's public trades feed and the
// trades of followed leaderboard traders. Needs the indexer running against the mock with
// TOP_TRADERS_URL=http://localhost:4100/leaderboard and INDEXER_TOP_POLL_MS=3000.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const TOP_TRADER = "0x00000000000000000000000000000000000070b0";
const WHALE = `0x${"5ea1".repeat(10)}`;
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("whale trades and top traders show in the feed, filtered by source", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(90_000);
  // A $400K market buy on SOL in two fills of one order; a small one that isn't a whale.
  await post("/__mock/trade", { coin: "SOL", px: 200, sz: 2000, side: "B", taker: WHALE, parts: 2 });
  await post("/__mock/trade", { coin: "SOL", px: 200, sz: 10, side: "A", taker: `0x${"0bad".repeat(10)}` });
  // The leaderboard trader opens a $67.5K DOGE long.
  await post("/__mock/fill", { user: TOP_TRADER, coin: "DOGE", px: 0.27, sz: 250000, dir: "Open Long" });

  await page.goto("/feed");
  const src = page.locator(".afsrc");
  await expect(src.getByRole("tab")).toHaveText(["All", "Swellfi", "🐋 Whales", "Top traders"]);

  await src.getByRole("tab", { name: "Whales" }).click();
  const whale = page.locator(".afi.whale", { hasText: "0x5ea1…5ea1" }).first();
  await expect(whale).toContainText("bought", { timeout: 30_000 });
  await expect(whale).toContainText("$400.0K");
  await expect(whale).toContainText("SOL");
  await expect(whale).toContainText("🐋 Whale");
  await expect(whale).toContainText("Hyperliquid · Market buy · 2000 SOL at 200.00");
  await expect(page.locator(".afeed")).not.toContainText("0x0bad…0bad"); // $2K: not a whale

  await src.getByRole("tab", { name: "Top traders" }).click();
  const top = page.locator(".afi", { hasText: "0x0000…70b0" }).first();
  await expect(top).toContainText("opened", { timeout: 30_000 });
  await expect(top).toContainText("Top trader");
  await expect(top).toContainText("DOGE");
  await expect(top).toContainText("Long");
  await expect(top).toContainText("Trade · Opened · $67.5K at");
  await expect(top.getByRole("button", { name: "Copy trade" })).toBeVisible();
  await expect(page.locator(".afeed")).not.toContainText("0x5ea1…5ea1");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/feed-top.png` });

  // Swellfi: members only. All: everything.
  await src.getByRole("tab", { name: "Swellfi" }).click();
  await expect(page.locator(".afeed")).not.toContainText("0x5ea1…5ea1");
  await expect(page.locator(".afeed")).not.toContainText("0x0000…70b0");
  await src.getByRole("tab", { name: "All" }).click();
  await expect(page.locator(".afi.whale", { hasText: "0x5ea1…5ea1" }).first()).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/feed-all.png` });

  // A whale's profile says who they are and where to look them up.
  await src.getByRole("tab", { name: "Whales" }).click();
  await page.locator(".afi.whale", { hasText: "0x5ea1…5ea1" }).first().locator(".afi-name").click();
  await expect(page.locator(".profile h2")).toHaveText("0x5ea1…5ea1");
  await expect(page.locator(".ext-note")).toContainText("A Hyperliquid trader. Not on Swellfi");
  await expect(page.locator(".ext-note a")).toHaveAttribute("href", `https://app.hyperliquid.xyz/explorer/address/${WHALE}`);
});
