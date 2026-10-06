import { expect, test } from "@playwright/test";

// The official contract address is on the home page and in the footer, and copies in one tap.
const CA = "0xde44a36d8a63623e195896d2b3183e2cf9ebccee";

test("home shows the token CA and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const hero = page.locator(".hero-ca");
  await expect(hero.locator("code")).toHaveAttribute("title", CA);
  await expect(page.locator(".foot-ca code")).toHaveAttribute("title", CA);
  await hero.getByRole("button", { name: "Copy contract address" }).click();
  await expect(page.locator(".toast")).toContainText("Contract address copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CA);
});
