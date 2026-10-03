import { expect, test } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// The platform builder wallet and its edge cases. The e2e build uses the first well-known
// Hardhat/Anvil test key as the builder (NEXT_PUBLIC_BUILDER_ADDRESS and MOCK_HL_BUILDER).
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const BUILDER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUILDER = (process.env.NEXT_PUBLIC_BUILDER_ADDRESS ?? "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266").toLowerCase();

const post = (path: string, body: unknown) => fetch(`${MOCK}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const mockState = async (user: string) => ((await (await fetch(`${MOCK}/__mock/state`)).json()) as Record<string, any>)[user.toLowerCase()]; // eslint-disable-line @typescript-eslint/no-explicit-any

async function onboard(page: import("@playwright/test").Page, key?: `0x${string}`) {
  const wallet = await installTestWallet(page, `${MOCK}/rpc`, key);
  await page.goto("/trade/SOL");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  const invite = page.locator(".modal.on").getByPlaceholder("Invite code");
  const signedIn = page.locator(".acct", { hasNotText: "Finish sign-up" });
  // The builder wallet may already be registered from an earlier run.
  await expect(invite.or(signedIn)).toBeVisible({ timeout: 15_000 });
  if (await invite.isVisible()) {
    await invite.fill(INVITE);
    await page.locator(".modal.on .checkline input").check();
    await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.locator(".acct")).toContainText(wallet.address.slice(0, 6).toLowerCase());
  await post("/__mock/deposit", { user: wallet.address, amount: 100 });
  return wallet;
}

test("the builder wallet trades without paying a fee to itself", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop flow");
  test.setTimeout(90_000);
  await post("/__mock/price", { coin: "SOL", px: 200 });
  const wallet = await onboard(page, BUILDER_KEY);
  expect(wallet.address.toLowerCase()).toBe(BUILDER);

  // Only the trading key is needed (a fresh browser has none): step 3, the platform fee, is done.
  await expect(page.locator(".checklist .ck").nth(2)).toHaveClass(/done/, { timeout: 15_000 });
  await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
  await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });
  await expect(page.locator(".checklist")).toHaveCount(0, { timeout: 15_000 });
  expect((await mockState(wallet.address)).builders[BUILDER]).toBeUndefined(); // never approved itself

  await page.locator(".otabs").getByRole("button", { name: "Market" }).click();
  await page.locator(".tord .frow", { hasText: "Size" }).locator("input").fill("20");
  await page.locator(".tord .bigbtn").click();
  await expect(page.locator(".toast")).toContainText("Filled", { timeout: 20_000 });
  const fill = (await mockState(wallet.address)).fills.at(-1);
  expect(fill.coin).toBe("SOL");
  expect(fill.builderFee).toBeUndefined();

  // Close it again so reruns start flat.
  await page.locator("#posBody").getByRole("button", { name: /^Close/ }).first().click();
  await expect(page.locator(".btabs")).not.toContainText(/Positions \(\d+\)/, { timeout: 20_000 });
});

// Empties the builder's balance for a moment, so other specs approving the builder at the same
// time would fail: only runs when asked (E2E_BUILDER_BALANCE=1, this file alone).
test("an unfunded builder: clear message, then trading opens once it is funded", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || !process.env.E2E_BUILDER_BALANCE, "set E2E_BUILDER_BALANCE=1 and run this file alone");
  test.setTimeout(90_000);
  await post("/__mock/usdc", { user: BUILDER, amount: 0 });
  try {
    const wallet = await onboard(page);
    await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
    await expect(page.locator(".toast")).toContainText("Swellfi's fee wallet isn't active on Hyperliquid yet", { timeout: 20_000 });
    await expect(page.locator(".checklist")).toBeVisible();
    expect((await mockState(wallet.address)).agents).toHaveLength(1); // the trading key went through

    await post("/__mock/usdc", { user: BUILDER, amount: 100 });
    await page.locator(".tord").getByRole("button", { name: "Enable trading" }).click();
    await expect(page.locator(".toast")).toContainText("Trading enabled", { timeout: 20_000 });
    await expect(page.locator(".checklist")).toHaveCount(0, { timeout: 15_000 });
    expect((await mockState(wallet.address)).builders[BUILDER]).toBe(50);
  } finally {
    await post("/__mock/usdc", { user: BUILDER, amount: 100 });
  }
});
