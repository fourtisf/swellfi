import path from "node:path";
import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Edit your profile (picture, username, bio) and see your own deposits and withdrawals.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";

test("edit profile and see deposit/withdrawal history", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK === "mainnet", "testnet build, desktop");
  test.setTimeout(120_000);
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  await page.locator(".modal.on").getByPlaceholder("Invite code").fill(INVITE);
  await page.locator(".modal.on .checkline input").check();
  await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());

  // Deposit 100, then withdraw 10.
  await page.locator(".tord").getByRole("button", { name: /^Deposit/ }).first().click();
  await page.locator(".modal.on input").fill("100");
  await page.locator(".modal.on").getByRole("button", { name: "Deposit", exact: true }).click();
  await page.locator(".modal.on").getByRole("button", { name: "Done" }).click({ timeout: 30_000 });
  await page.locator(".tacc").getByRole("button", { name: "Withdraw" }).click();
  await page.locator(".modal.on input").fill("10");
  await page.locator(".modal.on").getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Withdrawal of 10 USDC sent", { timeout: 20_000 });

  // Own profile shows the history (only to the owner) and the edit button.
  await page.locator(".acct").click();
  await page.getByRole("button", { name: "Your profile" }).click();
  const hist = page.locator(".hist");
  await expect(hist).toContainText("Only you see this");
  await expect(hist.locator("li", { hasText: "Deposit" })).toContainText("+100.00 USDC");
  const w = hist.locator("li", { hasText: "Withdrawal" });
  await expect(w).toContainText("−10.00 USDC");
  await expect(w).toContainText("Fee 1.00 USDC");
  await expect(w).toContainText("arriving on Arbitrum Sepolia");

  // Edit: picture, username, bio.
  const handle = `e2e_${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Edit profile" }).click();
  const m = page.locator(".modal.on");
  await m.locator('input[type="file"]').setInputFiles(path.join(__dirname, "../src/app/apple-icon.png"));
  await expect(m.locator(".pedit-pic img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
  await m.locator(".pedit-field input").fill("bad name!");
  await expect(m).toContainText("Use only letters, numbers and _");
  await expect(m.getByRole("button", { name: "Save" })).toBeDisabled();
  await m.locator(".pedit-field input").fill(handle);
  await m.locator("textarea").fill("BTC perps, swing trades.\n<b>not bold</b>");
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/profile-edit.png` });
  await m.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast")).toContainText("Profile saved");
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
  await expect(page.locator(".profile h2")).toHaveText(handle);
  await expect(page.locator(".profile")).toContainText("<b>not bold</b>"); // shown as text, never HTML
  const img = page.locator(".profile .who img");
  await expect(img).toHaveAttribute("src", /^\/api\/avatars\/[a-z0-9]+\?v=\d+$/);
  expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(256);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/profile.png`, fullPage: true });

  // Visitors see the profile but not the history or the edit button.
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(page.url());
  await expect(visitor.locator(".profile h2")).toHaveText(handle);
  await expect(visitor.locator(".hist")).toHaveCount(0);
  await expect(visitor.getByRole("button", { name: "Edit profile" })).toHaveCount(0);
  await visitor.close();
});
