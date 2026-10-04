import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// PnL cards: share an open position (read live from Hyperliquid) and a closed trade (indexed
// event); the card is a server-rendered PNG and the link's preview image. Needs the indexer.
// Trades HYPE so it never moves the prices other specs rely on.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("share a position and a closed trade as PnL cards", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(150_000);
  await post("/__mock/price", { coin: "HYPE", px: 40 });

  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  const handle = `trader_${wallet.address.slice(2, 8).toLowerCase()}`;
  await page.goto("/trade/HYPE");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
  await post("/__mock/deposit", { user: wallet.address, amount: 100 });
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });

  // Long HYPE: $20 margin at 10x, then the price rises.
  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });
  await post("/__mock/price", { coin: "HYPE", px: 41 });
  const row = page.locator("#posBody tbody tr", { hasText: "HYPE" });
  await expect(row).toContainText("$5.00", { timeout: 15_000 }); // 5 HYPE x $1

  // 1. The open position: card read live from Hyperliquid.
  await row.getByRole("button", { name: "Share HYPE PnL card" }).click();
  const modal = page.locator(".modal.on");
  await expect(modal.locator("h3")).toHaveText("Share your trade");
  const img = modal.locator(".share-prev img");
  await expect(modal.locator(".share-prev.ok")).toBeVisible({ timeout: 30_000 });
  await expect(img).toHaveAttribute("src", new RegExp(`^/p/${handle}/HYPE/image\\?t=\\d+$`));
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/share-modal.png` });
  await modal.getByLabel("Show dollar amounts (off: percentages only)").uncheck();
  await expect(img).toHaveAttribute("src", /amt=0/);
  await expect(modal.locator(".share-prev.ok")).toBeVisible({ timeout: 30_000 });
  // The image is a real PNG of the card size.
  const png = await page.request.get((await img.getAttribute("src"))!);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect((await png.body()).subarray(1, 4).toString()).toBe("PNG");
  await modal.locator(".mclose").click();

  // The indexer has seen the open (with its leverage) before we close, like most real trades.
  await expect
    .poll(async () => {
      const r = await page.request.get("/api/activity?kind=open&limit=50");
      const items = (await r.json()).items as { user: { handle: string }; data: { coin: string; lev?: number } }[];
      return items.find((i) => i.user.handle === handle && i.data.coin === "HYPE")?.data.lev ?? null;
    }, { timeout: 40_000 })
    .toBe(10);

  // Close it, then share the closed trade from the feed.
  await row.getByRole("button", { name: "Close" }).click();
  await page.locator(".modal.on").getByRole("button", { name: "Close all at market" }).click();
  await expect(page.locator(".toast")).toContainText("Close HYPE: Filled", { timeout: 20_000 });
  await page.goto("/feed");
  const closed = page.locator(".afi", { hasText: handle }).filter({ hasText: "closed" }).filter({ hasText: "HYPE" });
  await expect(closed).toBeVisible({ timeout: 40_000 });
  await closed.getByRole("button", { name: "Share" }).click();
  await expect(modal.locator(".share-prev.ok")).toBeVisible({ timeout: 30_000 });
  const src = (await img.getAttribute("src"))!;
  expect(src).toMatch(/^\/t\/fill%3A.+%3Aclose\/image$/);

  // 2. "Post on X" opens the composer with the share link, whose preview is the card.
  await context.route("https://x.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>X</title>" }));
  const [popup] = await Promise.all([context.waitForEvent("page"), modal.getByRole("button", { name: "Post on 𝕏" }).click()]);
  const intent = new URL(popup.url());
  expect(intent.hostname).toBe("x.com");
  expect(intent.searchParams.get("text")).toContain(`${handle} closed HYPE Long for +$`);
  const link = intent.searchParams.get("url")!;
  expect(link).toMatch(/\/t\/fill%3A.+%3Aclose$/);
  await popup.close();
  const html = await (await page.request.get(new URL(link).pathname)).text();
  expect(html).toContain(`${handle} closed HYPE Long for +`);
  expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"\/>/);
  expect(html).toMatch(/<meta property="og:image" content="[^"]+\/t\/fill%3A[^"]+%3Aclose\/image"\/>/);
  // Hidden amounts: the post text uses the return instead.
  await modal.getByLabel("Show dollar amounts (off: percentages only)").uncheck();
  await expect(modal.locator(".share-prev.ok")).toBeVisible({ timeout: 30_000 });
  const [popup2] = await Promise.all([context.waitForEvent("page"), modal.getByRole("button", { name: "Post on 𝕏" }).click()]);
  const intent2 = new URL(popup2.url());
  expect(intent2.searchParams.get("text")).toMatch(new RegExp(`${handle} closed HYPE Long for \\+\\d+\\.\\d%`));
  expect(intent2.searchParams.get("url")).toMatch(/\?amt=0$/);
  await popup2.close();
});
