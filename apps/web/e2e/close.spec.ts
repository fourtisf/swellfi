import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Closing a position: part at market, part with a resting limit, the rest with a limit that's
// already through the market. Trades LINK so it never moves the prices other specs rely on.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const mockState = async (user: string) => ((await (await fetch(`${MOCK}/__mock/state`)).json()) as Record<string, any>)[user.toLowerCase()]; // eslint-disable-line @typescript-eslint/no-explicit-any
const linkSize = async (user: string) => ((await mockState(user)).positions as { coin: string; szi: number }[]).find((p) => p.coin === "LINK")?.szi ?? 0;

test("close part at market, part with a limit, the rest with a marketable limit", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(120_000);
  await post("/__mock/price", { coin: "LINK", px: 20 });

  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await page.goto("/trade/LINK");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
  await post("/__mock/deposit", { user: wallet.address, amount: 100 });
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });

  // Long 10 LINK at 20 ($20 margin at 10x).
  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });
  const row = page.locator("#posBody tbody tr", { hasText: "LINK" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => linkSize(wallet.address)).toBe(10);

  // 1. A quarter at market.
  const modal = page.locator(".modal.on");
  await row.getByRole("button", { name: "Close" }).click();
  await expect(modal.locator("h3")).toContainText("Close · LINK");
  await expect(modal.getByRole("button", { name: "Close all at market" })).toBeVisible(); // default: everything
  await modal.getByRole("button", { name: "25%" }).click();
  await expect(modal).toContainText("2.5 of 10.0 LINK");
  await modal.getByRole("button", { name: "Close 25% at market" }).click();
  await expect(page.locator(".toast")).toContainText("Close LINK: Filled 2.5", { timeout: 20_000 });
  await expect.poll(() => linkSize(wallet.address)).toBe(7.5);

  // Size checks: nothing, or less than one lot (0.1 LINK).
  await row.getByRole("button", { name: "Close" }).click();
  const amount = modal.getByLabel("Percent of the position");
  await amount.fill("0");
  await expect(modal).toContainText("Choose how much to close");
  await amount.fill("1");
  await expect(modal).toContainText("Below the minimum size of 0.1 LINK");
  await expect(modal.locator(".submit")).toBeDisabled();

  // 2. Half with a limit above the market: it rests until the price gets there.
  await modal.getByRole("tab", { name: "Limit" }).click();
  await modal.getByLabel("Limit price").fill("21");
  await modal.getByRole("button", { name: "50%" }).click();
  await expect(modal).toContainText("3.7 of 7.5 LINK"); // 3.75 rounded down to whole lots
  await expect(modal).toContainText("Waits in Open Orders");
  await expect(modal).toContainText("Est. PnL $3.70");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/close-modal.png` });
  await modal.getByRole("button", { name: "Place limit close (50%)" }).click();
  await expect(page.locator(".toast")).toContainText("LINK: limit close placed at 21.000", { timeout: 20_000 });
  await expect(page.locator(".btabs")).toContainText("Open Orders (1)", { timeout: 15_000 });
  const resting = ((await mockState(wallet.address)).orders as { coin: string; r: boolean; s: string; p: string; tif: string }[]).filter((o) => o.coin === "LINK");
  expect(resting).toMatchObject([{ r: true, s: "3.7", p: "21", tif: "Gtc" }]);
  expect(await linkSize(wallet.address)).toBe(7.5);
  await post("/__mock/price", { coin: "LINK", px: 21.2 });
  await expect.poll(() => linkSize(wallet.address), { timeout: 15_000 }).toBeCloseTo(3.8, 6);

  // 3. The rest with a limit below the market: already through it, fills right away.
  await row.getByRole("button", { name: "Close" }).click();
  await modal.getByRole("tab", { name: "Limit" }).click();
  await modal.getByLabel("Limit price").fill("20.5");
  await expect(modal).toContainText("fills right away");
  await modal.getByRole("button", { name: "Place limit close (all)" }).click();
  await expect(page.locator(".toast")).toContainText("Close LINK: Filled 3.8", { timeout: 20_000 });
  await expect.poll(() => linkSize(wallet.address), { timeout: 15_000 }).toBe(0);
  // Analytics: realized PnL after fees, with the gross and the fee rate beside it.
  const ana = page.locator(".ana");
  await expect(ana).toContainText("before fees", { timeout: 15_000 });
  await expect(ana).toContainText("% of volume");
  if (process.env.E2E_SHOTS) await page.locator(".tbottom").screenshot({ path: `${process.env.E2E_SHOTS}/analytics.png` });
  const fills = (await mockState(wallet.address)).fills as { coin: string; dir: string; sz: string; closedPnl: string }[];
  const closes = fills.filter((f) => f.coin === "LINK" && f.dir === "Close Long");
  // 2.5 at 20 (flat), 3.7 at the 21 limit (+3.70), 3.8 at 21.2: the limit at 20.5 filled at the better price (+4.56).
  expect(closes.map((f) => [f.sz, +f.closedPnl]).reverse()).toEqual([
    ["2.5", 0],
    ["3.7", 3.7],
    ["3.8", 4.56],
  ]);
});
