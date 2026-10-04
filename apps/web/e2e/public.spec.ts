import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Public mode (API started with INVITE_ONLY=false): no waitlist, no invite code.
// Run with E2E_PUBLIC=1 against such an API.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";

test("anyone signs up with just a wallet when invites are off", async ({ page }, info) => {
  test.skip(!process.env.E2E_PUBLIC || info.project.name !== "desktop", "needs INVITE_ONLY=false, desktop");
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Join waitlist/i })).toHaveCount(0);
  await page.getByRole("button", { name: /Start trading/i }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  const m = page.locator(".modal.on");
  await expect(m.locator("h3")).toHaveText("Finish signing up");
  await expect(m.getByPlaceholder("Invite code")).toHaveCount(0);
  await m.locator(".checkline input").check();
  await m.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
});
