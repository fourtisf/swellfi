import { expect, test } from "@playwright/test";

test("home shows live markets, platform stats and activity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Every trade leaves a wake." })).toBeVisible();
  await expect(page.locator("#v-home tbody tr.click").first()).toBeVisible();
  await expect(page.locator(".pstats b").first()).toHaveText(/\d/);
  await expect(page.locator(".act").first()).toBeVisible();
});

test("terminal streams book and switches markets via the picker", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "picker covered on desktop");
  await page.goto("/trade");
  await expect(page.locator("#hPx")).toContainText("$");
  await page.getByRole("button", { name: /Book/ }).click();
  await expect(page.locator(".brow.a").first()).toBeVisible();
  await page.getByRole("button", { name: "Change market" }).click();
  await page.locator(".picker input").fill("NVDA");
  await page.locator(".picker .pk").first().click();
  await expect(page).toHaveURL(/\/trade\/xyz:NVDA$/);
  await expect(page.locator(".cpick b")).toHaveText("NVDA");
});

test("⌘K search finds markets and traders", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "keyboard shortcut");
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await page.locator(".cmd input").fill("eth");
  await expect(page.locator(".cmd .it").first()).toContainText("ETH");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/trade\/ETH$/);
});

test("waitlist signup", async ({ page }) => {
  await page.goto("/");
  await page.locator(".hero2").getByRole("button", { name: /Join waitlist/ }).click();
  await page.getByPlaceholder("you@email.com").fill(`e2e-${Date.now()}@example.com`);
  await page.locator(".modal.on").getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.locator(".toast")).toContainText("You're on the waitlist");
});

test("rankings, profile and fund pages load", async ({ page }) => {
  await page.goto("/rankings");
  await page.locator(".pod.first").click();
  await expect(page).toHaveURL(/\/u\//);
  await expect(page.locator(".profile h2")).toBeVisible();
  await page.goto("/funds");
  await page.locator(".fcard").first().click();
  await expect(page.getByText("Hyperliquid vault", { exact: true })).toBeVisible();
});
