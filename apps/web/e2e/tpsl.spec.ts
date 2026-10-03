import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// TP/SL on an open position: presets, validation, save, edit/remove, and the stop firing.
// Trades AVAX so it never moves the prices other specs rely on.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const mockState = async (user: string) => ((await (await fetch(`${MOCK}/__mock/state`)).json()) as Record<string, any>)[user.toLowerCase()]; // eslint-disable-line @typescript-eslint/no-explicit-any
type Order = { coin: string; r: boolean; s: string; trigger?: { tpsl: string; triggerPx: string } };

test("set, edit and remove TP/SL on an open position; the stop closes it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(120_000);
  await post("/__mock/price", { coin: "AVAX", px: 40 });

  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await page.goto("/trade/AVAX");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
  await post("/__mock/deposit", { user: wallet.address, amount: 100 });
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });

  // Market long: $20 margin at 10x = 5 AVAX at 40.
  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });
  const row = page.locator("#posBody tbody tr", { hasText: "AVAX" });
  await expect(row.locator(".tpsl-btn")).toContainText("Add", { timeout: 15_000 });

  // Open the editor: wrong-side prices are refused.
  await row.locator(".tpsl-btn").click();
  const modal = page.locator(".modal.on");
  await expect(modal.locator("h3")).toContainText("TP/SL · AVAX");
  await expect(modal.locator("h3")).toContainText("Long");
  const tp = modal.getByPlaceholder("Take profit price");
  const sl = modal.getByPlaceholder("Stop loss price");
  await sl.fill("41");
  await expect(modal).toContainText("Stop loss must be below the mark price");
  await expect(modal.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await sl.fill("30"); // below the liquidation price (38 at 10x in the mock)
  await expect(modal).toContainText("Past the liquidation price");

  // Presets: +50% of the $20 margin = +$10 = 42; -25% = -$5 = 39.
  await modal.locator(".tpsl-field", { hasText: "Take profit" }).getByRole("button", { name: "+50%" }).click();
  await expect(tp).toHaveValue("42.000");
  await expect(modal).toContainText("≈ $10.00 (+50.0%) if it triggers");
  await modal.locator(".tpsl-field", { hasText: "Stop loss" }).getByRole("button", { name: "−25%" }).click();
  await expect(sl).toHaveValue("39.000");
  await expect(modal).toContainText("≈ -$5.00 (-25.0%) if it triggers");
  await expect(modal.locator(".tpsl-field", { hasText: "Stop loss" }).getByRole("button", { name: "−50%" })).toHaveCount(0); // past liquidation
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/tpsl-modal.png` });
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".toast")).toContainText("AVAX: TP/SL saved", { timeout: 20_000 });
  await expect(row.locator(".tpsl-btn")).toContainText("42.000 / 39.000", { timeout: 15_000 });
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/tpsl-row.png` });
  let orders = ((await mockState(wallet.address)).orders as Order[]).filter((o) => o.coin === "AVAX" && o.trigger);
  expect(orders.map((o) => [o.trigger!.tpsl, o.trigger!.triggerPx, o.r, o.s]).sort()).toEqual([
    ["sl", "39", true, "5"],
    ["tp", "42", true, "5"],
  ]);

  // Edit: remove the take profit, keep the stop.
  await row.locator(".tpsl-btn").click();
  await expect(tp).toHaveValue("42.000");
  await modal.getByRole("button", { name: "Clear take profit" }).click();
  await expect(modal).toContainText("Removes the take profit at 42.000");
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".toast")).toContainText("TP/SL saved", { timeout: 20_000 });
  await expect(row.locator(".tpsl-btn")).toContainText("— / 39.000", { timeout: 15_000 });
  orders = ((await mockState(wallet.address)).orders as Order[]).filter((o) => o.coin === "AVAX" && o.trigger);
  expect(orders.map((o) => o.trigger!.tpsl)).toEqual(["sl"]);

  // The price drops through the stop: the position closes at market.
  await post("/__mock/price", { coin: "AVAX", px: 38.5 });
  await expect(page.locator(".btabs")).not.toContainText(/Positions \(\d+\)/, { timeout: 20_000 });
  const st = await mockState(wallet.address);
  expect(st.positions).toHaveLength(0);
  expect(+st.fills[0].closedPnl).toBeLessThan(0);
});
