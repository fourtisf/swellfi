import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Full trading lifecycle through the real UI against the mock Hyperliquid exchange (which checks
// every signature like Hyperliquid does): connect wallet → invite → deposit → enable trading →
// market buy with TP → TP triggers → withdraw. Desktop only.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "TIDE-ALPHA";
const BUILDER = (process.env.NEXT_PUBLIC_BUILDER_ADDRESS ?? "0x000000000000000000000000000000000000b0b1").toLowerCase();

const setPrice = (coin: string, px: number) => fetch(`${MOCK}/__mock/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, px }) });
const mockState = async (user: string) => ((await (await fetch(`${MOCK}/__mock/state`)).json()) as Record<string, any>)[user.toLowerCase()]; // eslint-disable-line @typescript-eslint/no-explicit-any

test("connect wallet → deposit → enable → trade with TP → withdraw", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop flow");
  test.setTimeout(120_000);
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await setPrice("BTC", 100_000);

  // 1. Connect wallet (sign-in message) and redeem an invite.
  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wopt", { hasText: "MetaMask" }).click();
  await expect(page.locator(".modal.on h3")).toHaveText(/Enter your invite/);
  await page.getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".toast")).toContainText("Welcome");
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());

  // 2. Deposit 100 USDC from Arbitrum (mock RPC) and wait for the Hyperliquid credit.
  await expect(page.locator(".checklist")).toBeVisible();
  await page.locator(".tord").getByRole("button", { name: "Deposit USDC" }).click();
  await expect(page.locator(".modal.on")).toContainText("1000.00 USDC");
  await page.locator(".modal.on input").fill("4");
  await page.locator(".modal.on").getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.locator(".modal.on .err")).toContainText("Minimum deposit is 5 USDC");
  await page.locator(".modal.on input").fill("100");
  await page.locator(".modal.on").getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.locator(".modal.on").getByRole("button", { name: "Done" })).toBeVisible({ timeout: 30_000 });
  await page.locator(".modal.on").getByRole("button", { name: "Done" }).click();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/trade-checklist.png` });

  // 3. Enable trading: approveAgent + approveBuilderFee, signed by the wallet.
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });
  await expect(page.locator(".checklist")).toHaveCount(0, { timeout: 15_000 });
  let st = await mockState(wallet.address);
  expect(st.agents).toHaveLength(1);
  expect(st.agents[0].name).toBe("tideline");
  expect(st.builders[BUILDER]).toBe(50);

  // 4. Market buy 20 USDC margin at 10x with a take profit at 101,000.
  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.getByRole("button", { name: "+ Add TP/SL" }).click();
  await page.getByPlaceholder("Take profit price").fill("101000");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });
  await expect(page.locator(".btabs")).toContainText("Positions (1)", { timeout: 15_000 });
  await expect(page.locator("#posBody")).toContainText("Long");
  await expect(page.locator("#posBody")).toContainText("101,000.0"); // TP shown on the position
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/trade-position.png` });
  st = await mockState(wallet.address);
  expect(st.positions[0]).toMatchObject({ coin: "BTC", szi: 0.002, lev: 10 });
  expect(+st.fills[0].builderFee).toBeCloseTo(200 * 0.0005); // 0.05% builder fee on $200
  expect(st.orders.find((o: { trigger?: unknown }) => o.trigger)?.builder).toEqual({ b: BUILDER, f: 50 });

  // 5. Price rallies through the TP: the position closes on Hyperliquid.
  await setPrice("BTC", 101_500);
  await expect(page.locator(".btabs")).not.toContainText("Positions (1)", { timeout: 20_000 });
  await page.locator(".btabs").getByRole("button", { name: "Order History" }).click();
  await expect(page.locator("#posBody")).toContainText("triggered");
  st = await mockState(wallet.address);
  expect(st.positions).toHaveLength(0);
  expect(+st.fills[0].closedPnl).toBeGreaterThan(0);

  // 6. Withdraw 10 USDC to the wallet.
  await page.locator(".tacc").getByRole("button", { name: "Withdraw" }).click();
  await page.locator(".modal.on input").fill("10");
  await page.locator(".modal.on").getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Withdrawal of 10 USDC sent", { timeout: 20_000 });
  st = await mockState(wallet.address);
  expect(st.withdrawals).toEqual([expect.objectContaining({ amount: 10, destination: wallet.address.toLowerCase() })]);
});
