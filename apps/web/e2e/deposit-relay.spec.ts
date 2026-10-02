import { expect, test, type Page, type Route } from "@playwright/test";
import { installTestWallet } from "./wallet-fixture";

// Deposits from other networks/tokens, routed by Relay. Needs a MAINNET build of the web app
// (NEXT_PUBLIC_HL_NETWORK=mainnet) against the mock in mainnet mode (MOCK_HL_NETWORK=mainnet).
// The Relay API and the Base RPC are mocked in the browser; Relay's "fill" credits the mock
// Hyperliquid account through /__mock/deposit. Desktop only.
const MOCK = process.env.MOCK_HL_URL ?? "http://localhost:4100";
const INVITE = process.env.E2E_INVITE_CODE ?? "SWELL-ALPHA";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const HYPERCORE_USDC = "0x00000000000000000000000000000000";
const RELAY_RECEIVER = "0x4cd00e387622c35bddb9b4c962c136462338bc31";

const mockState = async (user: string) => ((await (await fetch(`${MOCK}/__mock/state`)).json()) as Record<string, any>)[user.toLowerCase()]; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Base RPC: chain id and token decimals answered here, everything else (balances, sends, receipts) by the mock. */
async function routeBaseRpc(page: Page) {
  const handle = async (route: Route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 204 });
    const body = route.request().postDataJSON();
    const one = async (m: { id: number; method: string; params?: { data?: string }[] }) => {
      if (m.method === "eth_chainId") return { jsonrpc: "2.0", id: m.id, result: "0x2105" };
      if (m.method === "eth_call" && m.params?.[0]?.data?.startsWith("0x313ce567")) return { jsonrpc: "2.0", id: m.id, result: `0x${"6".padStart(64, "0")}` };
      const r = await fetch(`${MOCK}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
      return r.json();
    };
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(out) });
  };
  await page.route((u) => u.hostname === "mainnet.base.org" || u.hostname === "base-rpc.publicnode.com", handle);
}

interface RelayMock {
  quotes: Record<string, unknown>[];
  statusCalls: number;
}

/** Relay API: /quote/v2, /intents/status/v3 and the tx index calls. */
async function routeRelay(page: Page, user: string, opts: { recipient?: string } = {}) {
  const m: RelayMock = { quotes: [], statusCalls: 0 };
  let credited = false;
  await page.route(
    (u) => u.hostname === "api.relay.link",
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, body: JSON.stringify(body) });
      if (req.method() === "OPTIONS") return json(204, {});
      if (url.pathname === "/quote/v2") {
        const q = req.postDataJSON();
        m.quotes.push(q);
        const units = BigInt(q.amount);
        const out = ((units * 996n) / 1000n) * 100n; // 0.4% fees, 6 → 8 decimals
        return json(200, {
          steps: [
            {
              id: "deposit",
              action: "Confirm transaction in your wallet",
              description: "Depositing funds to the relayer",
              kind: "transaction",
              requestId: "0xfeed",
              items: [{ status: "incomplete", data: { from: user, to: RELAY_RECEIVER, data: "0xdeadbeef", value: "0", chainId: 8453 }, check: { endpoint: "/intents/status?requestId=0xfeed", method: "GET" } }],
            },
          ],
          fees: { gas: { amountUsd: "0.01" }, relayer: { amountUsd: (Number(units) * 0.004e-6 - 0.01).toFixed(4) }, app: { amountUsd: "0" } },
          details: {
            operation: "swap",
            sender: user,
            recipient: opts.recipient ?? user,
            currencyIn: { currency: { chainId: 8453, address: BASE_USDC, symbol: "USDC", decimals: 6 }, amount: q.amount, amountFormatted: (Number(units) / 1e6).toString(), amountUsd: (Number(units) / 1e6).toFixed(2) },
            currencyOut: { currency: { chainId: 1337, address: HYPERCORE_USDC, symbol: "USDC", decimals: 8 }, amount: out.toString(), amountFormatted: (Number(out) / 1e8).toString(), amountUsd: (Number(out) / 1e8).toFixed(2) },
            timeEstimate: 6,
          },
        });
      }
      if (url.pathname === "/intents/status/v3") {
        m.statusCalls++;
        if (m.statusCalls < 2) return json(200, { status: "pending", originChainId: 8453 });
        if (!credited) {
          credited = true;
          const out = Number(BigInt(m.quotes.at(-1)!.amount as string) * 996n / 1000n) / 1e6;
          await fetch(`${MOCK}/__mock/deposit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, amount: out }) });
        }
        return json(200, { status: "success", originChainId: 8453, destinationChainId: 1337, txHashes: [`0x${"ab".repeat(32)}`] });
      }
      if (url.pathname.startsWith("/transactions/")) return json(200, { message: "ok" });
      return json(404, { message: `not mocked: ${url.pathname}` });
    },
  );
  return m;
}

async function connect(page: Page, address: string) {
  await page.goto("/trade/BTC");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.locator(".modal.on .wtile", { hasText: "MetaMask" }).click();
  const invite = page.getByPlaceholder("Invite code");
  await expect(invite.or(page.locator(".toast", { hasText: "Welcome" }))).toBeVisible();
  if (await invite.isVisible()) {
    await invite.fill(INVITE);
    await page.locator(".modal.on .checkline input").check();
    await page.locator(".modal.on").getByRole("button", { name: "Continue" }).click();
  }
  await expect(page.locator(".acct")).toContainText(address.slice(0, 6).toLowerCase());
}

async function openBaseUsdc(page: Page) {
  await page.locator(".tord").getByRole("button", { name: /^Deposit/ }).click();
  const modal = page.locator(".modal.on");
  await expect(modal.locator("h3")).toHaveText("Deposit");
  await modal.locator(".netbtn", { hasText: "Base" }).click();
  await modal.locator(".tokrow .netbtn", { hasText: "USDC" }).click();
  await expect(modal).toContainText("On Base: 1000.00 USDC");
  return modal;
}

test("deposit USDC from Base via Relay lands in the Hyperliquid account", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK !== "mainnet", "mainnet build, desktop");
  test.setTimeout(90_000);
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await routeBaseRpc(page);
  const relay = await routeRelay(page, wallet.address);
  const dialogs: string[] = [];
  page.on("dialog", (d) => (dialogs.push(d.message()), d.accept()));

  await connect(page, wallet.address);
  const modal = await openBaseUsdc(page);
  // Arbitrum USDC keeps the direct bridge (warning), Base shows a Relay quote.
  await modal.locator("input").fill("50");
  await expect(modal.locator(".quotebox")).toContainText("≈ 49.80 USDC");
  await expect(modal.locator(".quotebox")).toContainText("≈ $0.20");
  const q = relay.quotes.at(-1)!;
  expect(q).toMatchObject({ originChainId: 8453, originCurrency: BASE_USDC, destinationChainId: 1337, destinationCurrency: HYPERCORE_USDC, amount: "50000000", tradeType: "EXACT_INPUT", referrer: "swellfi.xyz" });
  expect(String(q.user).toLowerCase()).toBe(wallet.address.toLowerCase());
  expect(String(q.recipient).toLowerCase()).toBe(wallet.address.toLowerCase());

  const before = (await mockState(wallet.address))?.usdc?.[""] ?? 0;
  await modal.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Done" })).toBeVisible({ timeout: 45_000 });
  expect(dialogs.at(-1)).toContain("from Base to Hyperliquid MAINNET via Relay");
  expect(dialogs.at(-1)).toContain("about 49.80 USDC");
  await expect(modal.locator(".steps-v div.ok")).toHaveCount(4);
  await expect(modal.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", /^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/);
  await expect(page.locator(".toast")).toContainText("Deposit credited");
  expect((await mockState(wallet.address)).usdc[""] - before).toBeCloseTo(49.8);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/deposit-relay.png` });
});

test("a Relay quote paying someone else is refused", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK !== "mainnet", "mainnet build, desktop");
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  await routeBaseRpc(page);
  await routeRelay(page, wallet.address, { recipient: "0x000000000000000000000000000000000000bad1" });
  await connect(page, wallet.address);
  const modal = await openBaseUsdc(page);
  await modal.locator("input").fill("20");
  await expect(modal.locator(".err")).toContainText("Relay returned a different recipient");
  await expect(modal.getByRole("button", { name: "Deposit", exact: true })).toBeDisabled();
});

test("Arbitrum USDC on mainnet still goes straight to the bridge", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.E2E_NETWORK !== "mainnet", "mainnet build, desktop");
  const wallet = await installTestWallet(page, `${MOCK}/rpc`);
  let relayCalls = 0;
  await page.route((u) => u.hostname === "api.relay.link", (r) => (relayCalls++, r.abort()));
  await connect(page, wallet.address);
  await page.locator(".tord").getByRole("button", { name: /^Deposit/ }).click();
  const modal = page.locator(".modal.on");
  await expect(modal.locator(".netgrid .netbtn.on")).toContainText("Arbitrum");
  await expect(modal).toContainText("On Arbitrum One: 1000.00 USDC");
  await expect(modal.locator(".warnbox")).toContainText("Deposits below 5 USDC are lost");
  await expect(modal.locator(".quotebox")).toHaveCount(0);
  // Switching to USDT on Arbitrum moves to Relay.
  await modal.locator(".tokrow .netbtn", { hasText: "USDT" }).click();
  await expect(modal.locator(".quotebox")).toBeVisible();
  expect(relayCalls).toBe(0);
});
