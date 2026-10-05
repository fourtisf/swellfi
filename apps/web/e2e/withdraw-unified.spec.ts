import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// A unified Hyperliquid account keeps its USDC in the spot balance and shows 0 withdrawable on the
// perps side; the withdraw form must offer the spot USDC.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("withdraw from a unified account", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(90_000);
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await post("/__mock/unified", { user: wallet.address, amount: 147.67 });
  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText("$147.67");

  await page.locator(".tacc").getByRole("button", { name: "Withdraw" }).click();
  const m = page.locator(".modal.on");
  await expect(m).toContainText("Withdrawable: $147.67");
  await m.getByRole("button", { name: "Max" }).click();
  await expect(m.locator("input")).toHaveValue("147.67");
  await m.locator("input").fill("20");
  await m.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Withdrawal of 20 USDC sent", { timeout: 20_000 });
  await expect(page.locator(".acct")).toContainText("$127.67", { timeout: 15_000 });
});
