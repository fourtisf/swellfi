import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Analytics read the wallet's whole Hyperliquid history (trades made on any app). A new member
// sees only trades since joining by default, and can switch to all time.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("analytics start at sign-up, with all-time history on request", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(90_000);
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  // A losing trade on this wallet a month before it ever used Swellfi.
  const old = Date.now() - 30 * 86_400_000;
  await post("/__mock/fill", { user: wallet.address, coin: "DOGE", px: 0.2, sz: 1000, dir: "Open Long", time: old - 3_600_000 });
  await post("/__mock/fill", { user: wallet.address, coin: "DOGE", px: 0.15, sz: 1000, dir: "Close Long", closedPnl: -50, time: old });

  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());

  const stat = (k: string) => page.locator(".ana > div").filter({ has: page.locator("small", { hasText: new RegExp(`^${k}$`, "i") }) }).locator("b");
  const range = page.locator(".ana-range");
  await expect(range.getByRole("button", { name: "Since joining" })).toHaveClass(/on/);
  await expect(stat("Closed trades")).toHaveText("0");
  await expect(stat("Realized PnL")).toContainText("$0.00");

  await range.getByRole("button", { name: "All time" }).click();
  await expect(stat("Closed trades")).toHaveText("1");
  await expect(stat("Realized PnL")).toContainText("-$50.");
  await expect(stat("Volume")).toContainText("$350.00");
});
