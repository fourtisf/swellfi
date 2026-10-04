import { expect, test, type Browser, type Page } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Activity feed end to end: a trade on Hyperliquid (mock) is picked up by the indexer
// (apps/api dist/indexer-main.js, pointed at the mock) and shows up as "opened" / "closed"
// events that other traders can like, follow and copy. Needs the indexer running.
// Trades ETH so it never moves the BTC price other specs rely on.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const setPrice = (coin: string, px: number) => fetch(`${MOCK}/__mock/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, px }) });

async function signUp(page: Page) {
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
  return { wallet, handle: `trader_${wallet.address.slice(2, 8).toLowerCase()}` };
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

test("trades show up in the activity feed; others like, follow and copy them", async ({ page, browser }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(150_000);
  await setPrice("ETH", 3_000);

  // Trader A: deposit, enable trading, market long ETH with a take profit.
  const a = await signUp(page);
  await page.goto("/trade/ETH");
  await page.locator(".tord").getByRole("button", { name: /^Deposit/ }).first().click();
  await page.locator(".modal.on input").fill("100");
  await page.locator(".modal.on").getByRole("button", { name: "Deposit", exact: true }).click();
  await page.locator(".modal.on").getByRole("button", { name: "Done" }).click({ timeout: 30_000 });
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });
  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.getByRole("button", { name: "+ Add TP/SL" }).click();
  await page.getByPlaceholder("Take profit price").fill("3030");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });

  // The indexer turns the fill into an "opened" event.
  await page.goto("/feed");
  const mine = page.locator(".afi", { hasText: a.handle });
  const opened = mine.filter({ hasText: "opened" });
  await expect(opened).toContainText("ETH", { timeout: 30_000 });
  await expect(opened).toContainText("Long");
  await expect(opened).toContainText("Trade · Opened · $200 at");
  await expect(opened).toContainText("10x");
  await expect(opened.getByRole("button", { name: "Copy trade" })).toHaveCount(0); // not on your own trades

  // Price rallies through the TP: the close shows with PnL and entry -> exit.
  await setPrice("ETH", 3_060);
  const closed = mine.filter({ hasText: "closed" });
  await expect(closed).toContainText(/Trade · Closed · \+\$\d/, { timeout: 40_000 });
  await expect(closed).toContainText(/3,0\d\d\.\d+ → 3,0\d\d\.\d+/);
  await expect(page.locator(".afsum")).toContainText("traded today");
  await expect(page.locator(".afsum")).toContainText("most traded"); // which coin depends on the day's other trades
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/feed.png` });

  // Trader B: likes A's close, follows A, then copies A's open.
  const pb = await newPage(browser);
  await signUp(pb);
  await pb.goto("/feed");
  const bClosed = pb.locator(".afi", { hasText: a.handle }).filter({ hasText: "closed" });
  await expect(bClosed).toBeVisible({ timeout: 20_000 });
  const like = bClosed.getByRole("button", { name: "Like" });
  await like.click();
  await expect(bClosed.getByRole("button", { name: "Unlike" })).toContainText("1");
  await pb.reload();
  await expect(pb.locator(".afi", { hasText: a.handle }).filter({ hasText: "closed" }).getByRole("button", { name: "Unlike" })).toContainText("1");

  // Following tab is empty until B follows A (from A's profile).
  await pb.locator(".seg").getByRole("button", { name: "Following" }).click();
  await expect(pb.locator(".afeed")).toContainText("Nothing from the traders you follow yet");
  await expect(pb.locator(".sugg li").first()).toBeVisible({ timeout: 20_000 });
  await pb.goto(`/u/${a.handle}`);
  await pb.locator(".profile").getByRole("button", { name: "Follow", exact: true }).click();
  await expect(pb.locator(".profile").getByRole("button", { name: "Following" })).toBeVisible();
  await pb.goto("/feed");
  await pb.locator(".seg").getByRole("button", { name: "Following" }).click();
  await expect(pb.locator(".afi", { hasText: a.handle }).first()).toBeVisible({ timeout: 20_000 });

  // Filter: closes only.
  await pb.locator(".seg").getByRole("button", { name: "Global" }).click();
  await pb.locator(".afkind").selectOption("close");
  await expect(pb.locator(".afi", { hasText: a.handle }).filter({ hasText: "opened" })).toHaveCount(0);
  await expect(pb.locator(".afi", { hasText: a.handle }).filter({ hasText: "closed" })).toBeVisible();
  await pb.locator(".afkind").selectOption("trades");

  // Copy trade prefills the order panel (market, Long, 10x) without placing anything.
  await pb.goto("/trade/ETH");
  await pb.locator('.tord button[data-side="short"]').click();
  await pb.locator(".otabs").getByRole("button", { name: "Limit" }).click();
  // Client-side navigation keeps the order panel state (a full page load would reset it).
  await pb.locator("header").getByRole("link", { name: "Feed", exact: true }).click();
  await expect(pb).toHaveURL(/\/feed$/);
  await pb.locator(".afi", { hasText: a.handle }).filter({ hasText: "opened" }).getByRole("button", { name: "Copy trade" }).click();
  await expect(pb).toHaveURL(/\/trade\/ETH$/);
  await expect(pb.locator(".toast")).toContainText("Order panel set to ETH Long 10x");
  await expect(pb.locator('.tord button[data-side="long"]')).toHaveClass(/on/);
  await expect(pb.locator(".otabs").getByRole("button", { name: "Market" })).toHaveClass(/on/);
  await expect(pb.locator(".tord .frow", { hasText: "Size" }).locator("input")).toHaveValue("");
  await pb.context().close();
});
