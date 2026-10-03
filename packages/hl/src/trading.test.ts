import { HttpTransport } from "@nktkas/hyperliquid";
import { createL1ActionHash } from "@nktkas/hyperliquid/signing";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  agentExchange,
  agentNameWithExpiry,
  buildClose,
  buildOrder,
  buildPositionTpsl,
  builderMaxFeeRate,
  fillAnalytics,
  masterExchange,
  OrderInputError,
  parsePositions,
  summarizeAccount,
  summarizeStatuses,
  toUsdcUnits,
  validateDeposit,
  validateWithdraw,
  type ClearinghouseLike,
} from "./index";

const BUILDER = { address: "0xAbCdEf0000000000000000000000000000000001", feeTenthsBps: 50 };
const BTC = { name: "BTC", assetId: 0, szDecimals: 5 };
const NVDA = { name: "xyz:NVDA", assetId: 110003, szDecimals: 3 };

describe("buildOrder", () => {
  it("market buy = IOC limit crossing by slippage, rounded to 5 sig figs, with builder", () => {
    const o = buildOrder({ market: BTC, side: "long", type: "market", mid: 96420.5, size: 0.0123456, builder: BUILDER });
    expect(o.grouping).toBe("na");
    expect(o.builder).toEqual({ b: "0xabcdef0000000000000000000000000000000001", f: 50 });
    expect(o.orders).toEqual([{ a: 0, b: true, p: "99313", s: "0.01234", r: false, t: { limit: { tif: "Ioc" } } }]);
  });

  it("market sell crosses down; limit uses GTC or ALO", () => {
    const sell = buildOrder({ market: BTC, side: "short", type: "market", mid: 100000, size: 0.001, builder: BUILDER });
    expect(sell.orders[0]).toMatchObject({ b: false, p: "97000" });
    const lim = buildOrder({ market: BTC, side: "long", type: "limit", mid: 100000, px: 95000.123, size: 0.001, builder: BUILDER });
    expect(lim.orders[0]).toMatchObject({ p: "95000", t: { limit: { tif: "Gtc" } } });
    const alo = buildOrder({ market: BTC, side: "long", type: "limit", mid: 100000, px: 95000, size: 0.001, postOnly: true, builder: BUILDER });
    expect(alo.orders[0]!.t).toEqual({ limit: { tif: "Alo" } });
  });

  it("stop market picks trigger direction from where the trigger sits", () => {
    const breakout = buildOrder({ market: BTC, side: "long", type: "stop", mid: 100000, px: 105000, size: 0.001, builder: BUILDER });
    expect(breakout.orders[0]!.t).toEqual({ trigger: { isMarket: true, triggerPx: "105000", tpsl: "sl" } });
    const dip = buildOrder({ market: BTC, side: "long", type: "stop", mid: 100000, px: 95000, size: 0.001, builder: BUILDER });
    expect(dip.orders[0]!.t).toMatchObject({ trigger: { tpsl: "tp" } });
    const sl = buildOrder({ market: BTC, side: "short", type: "stopLimit", mid: 100000, px: 95000, limitPx: 94900, size: 0.001, builder: BUILDER });
    expect(sl.orders[0]).toMatchObject({ b: false, p: "94900", t: { trigger: { isMarket: false, triggerPx: "95000", tpsl: "sl" } } });
    expect(() => buildOrder({ market: BTC, side: "short", type: "stopLimit", mid: 100000, px: 95000, size: 0.001, builder: BUILDER })).toThrow(/valid price/);
  });

  it("attaches TP/SL as reduce-only children under normalTpsl", () => {
    const o = buildOrder({ market: NVDA, side: "long", type: "limit", mid: 180, px: 180, size: 1, tp: 200, sl: 170, builder: BUILDER });
    expect(o.grouping).toBe("normalTpsl");
    expect(o.orders).toHaveLength(3);
    expect(o.orders[1]).toMatchObject({ a: 110003, b: false, r: true, s: "1", t: { trigger: { triggerPx: "200", tpsl: "tp", isMarket: true } } });
    expect(o.orders[2]).toMatchObject({ b: false, r: true, t: { trigger: { triggerPx: "170", tpsl: "sl" } } });
    expect(() => buildOrder({ market: NVDA, side: "long", type: "limit", mid: 180, px: 180, size: 1, tp: 170, builder: BUILDER })).toThrow(/Take profit must be above/);
    expect(() => buildOrder({ market: NVDA, side: "short", type: "limit", mid: 180, px: 180, size: 1, sl: 170, builder: BUILDER })).toThrow(/Stop loss must be above/);
  });

  it("enforces the builder, $10 minimum, lot size and tradability", () => {
    const base = { market: BTC, side: "long" as const, type: "market" as const, mid: 100000, size: 0.001 };
    expect(() => buildOrder({ ...base, builder: { address: null, feeTenthsBps: 50 } })).toThrow(OrderInputError);
    expect(() => buildOrder({ ...base, builder: { ...BUILDER, feeTenthsBps: 101 } })).toThrow(/0–100/);
    expect(() => buildOrder({ ...base, size: 0.00005, builder: BUILDER })).toThrow(/Minimum order value/);
    expect(() => buildOrder({ ...base, size: 0.000001, builder: BUILDER })).toThrow(/minimum lot/);
    expect(() => buildOrder({ ...base, reduceOnly: true, size: 0.00005, builder: BUILDER })).not.toThrow();
    expect(() => buildOrder({ ...base, market: { ...BTC, assetId: -1 }, builder: BUILDER })).toThrow(/can't be traded/);
  });
});

describe("close / position TP-SL / statuses", () => {
  it("closes a short with a reduce-only IOC buy", () => {
    const o = buildClose({ market: BTC, szi: -0.5, mid: 100000, builder: BUILDER });
    expect(o.orders[0]).toMatchObject({ b: true, s: "0.5", r: true, p: "103000", t: { limit: { tif: "Ioc" } } });
    expect(buildClose({ market: BTC, szi: 0.5, mid: 100000, fraction: 0.5, builder: BUILDER }).orders[0]).toMatchObject({ b: false, s: "0.25" });
    // limit close: resting GTC at the given price, reduce-only
    expect(buildClose({ market: BTC, szi: 0.5, mid: 100000, fraction: 0.25, limitPx: 101234.56, builder: BUILDER }).orders[0]).toMatchObject({ b: false, p: "101230", s: "0.125", r: true, t: { limit: { tif: "Gtc" } } });
    expect(() => buildClose({ market: BTC, szi: 0.5, mid: 100000, limitPx: 0, builder: BUILDER })).toThrow("valid price");
    expect(() => buildClose({ market: BTC, szi: 0.5, mid: 100000, fraction: 0, builder: BUILDER })).toThrow("how much");
    expect(() => buildClose({ market: BTC, szi: 0.5, mid: 100000, fraction: 0.000001, builder: BUILDER })).toThrow("minimum lot");
    // explicit size in coin, kept exact through float noise; never more than the position
    expect(buildClose({ market: BTC, szi: 0.0084, mid: 100000, size: 0.0084 * 0.5, builder: BUILDER }).orders[0]).toMatchObject({ s: "0.0042" });
    expect(0.3 - 0.1).toBeLessThan(0.2); // float noise below the lot boundary
    expect(buildClose({ market: BTC, szi: 0.5, mid: 100000, size: 0.3 - 0.1, builder: BUILDER }).orders[0]).toMatchObject({ s: "0.2" });
    expect(() => buildClose({ market: BTC, szi: 0.0084, mid: 100000, size: 0.009, builder: BUILDER })).toThrow("how much");
  });

  it("builds positionTpsl sized to the position", () => {
    const o = buildPositionTpsl({ market: BTC, szi: 0.2, tp: 110000, sl: 90000, builder: BUILDER });
    expect(o.grouping).toBe("positionTpsl");
    expect(o.orders.map((x) => [x.b, x.s, x.r])).toEqual([[false, "0.2", true], [false, "0.2", true]]);
    expect(() => buildPositionTpsl({ market: BTC, szi: 0.2, builder: BUILDER })).toThrow();
  });

  it("summarizes statuses and surfaces errors", () => {
    expect(summarizeStatuses([{ filled: { totalSz: "0.1", avgPx: "100", oid: 1 } }])).toBe("Filled 0.1 at 100");
    expect(summarizeStatuses([{ resting: { oid: 1 } }, "waitingForTrigger"])).toBe("Order placed");
    expect(() => summarizeStatuses([{ error: "Insufficient margin" }])).toThrow("Insufficient margin");
  });
});

describe("account parsing", () => {
  const state: ClearinghouseLike = {
    assetPositions: [
      { position: { coin: "ETH", szi: "-0.5", entryPx: "3000", positionValue: "1450", unrealizedPnl: "50", returnOnEquity: "0.33", liquidationPx: "3500", marginUsed: "150", leverage: { type: "cross", value: 10 }, cumFunding: { sinceOpen: "-1.2" } } },
      { position: { coin: "BTC", szi: "0.0", entryPx: "1", positionValue: "0", unrealizedPnl: "0", returnOnEquity: "0", liquidationPx: null, marginUsed: "0", leverage: { type: "isolated", value: 3 }, cumFunding: { sinceOpen: "0" } } },
    ],
    marginSummary: { accountValue: "1000", totalMarginUsed: "150", totalNtlPos: "1450" },
    withdrawable: "850",
  };
  it("drops flat positions and sums dexes", () => {
    const pos = parsePositions(state);
    expect(pos).toHaveLength(1);
    expect(pos[0]).toMatchObject({ coin: "ETH", szi: -0.5, liquidationPx: 3500, leverage: { type: "cross", value: 10 } });
    const s = summarizeAccount([state, { ...state, assetPositions: [], marginSummary: { accountValue: "100", totalMarginUsed: "0", totalNtlPos: "0" }, withdrawable: "100" }], pos);
    expect(s).toMatchObject({ accountValue: 1100, withdrawable: 950, marginUsed: 150, unrealizedPnl: 50 });
    expect(s.leverage).toBeCloseTo(1450 / 1100);
  });

  it("computes analytics without double-counting builder fees", () => {
    const a = fillAnalytics([
      { coin: "ETH", px: "3000", sz: "1", closedPnl: "0", fee: "1.5", builderFee: "1.5", time: 1 },
      { coin: "ETH", px: "3100", sz: "1", closedPnl: "100", fee: "1.6", builderFee: "1.55", time: 2 },
      { coin: "BTC", px: "100", sz: "1", closedPnl: "-20", fee: "0.1", time: 3 },
    ]);
    expect(a).toMatchObject({ realized: 80, volume: 6200, closed: 2, winRate: 50, best: 100 });
    expect(a.fees).toBeCloseTo(3.2);
    expect(a.builderFees).toBeCloseTo(3.05);
  });
});

describe("bridge", () => {
  it("parses USDC amounts exactly and enforces the 5 USDC minimum", () => {
    expect(toUsdcUnits("5")).toBe(5_000_000n);
    expect(toUsdcUnits("12.3456789")).toBe(12_345_678n);
    expect(() => toUsdcUnits("1e3")).toThrow();
    expect(validateDeposit("4.99", 10_000_000n)).toMatch(/Minimum deposit is 5 USDC/);
    expect(validateDeposit("6", 5_000_000n)).toMatch(/Not enough/);
    expect(validateDeposit("5", 5_000_000n)).toBeNull();
    expect(validateWithdraw("1", 100)).toMatch(/fee/);
    expect(validateWithdraw("200", 100)).toMatch(/withdrawable/);
    expect(validateWithdraw("50", 100)).toBeNull();
  });
});

describe("signing through the SDK", () => {
  function captureTransport(isTestnet: boolean, response: unknown = { status: "ok", response: { type: "order", data: { statuses: [{ resting: { oid: 7 } }] } } }) {
    const sent: { endpoint: string; payload: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = new HttpTransport({ isTestnet });
    vi.spyOn(t, "request").mockImplementation(async (endpoint: string, payload: unknown) => {
      sent.push({ endpoint, payload });
      return response as never;
    });
    return { t, sent };
  }

  it("agent signs an order (with builder) that recovers to the agent on testnet", async () => {
    const agent = privateKeyToAccount(generatePrivateKey());
    const { t, sent } = captureTransport(true);
    const params = buildOrder({ market: BTC, side: "long", type: "limit", mid: 100000, px: 95000, size: 0.001, builder: BUILDER });
    const res = await agentExchange(t, agent).order(params);
    expect(summarizeStatuses(res.response.data.statuses)).toBe("Order placed");
    const { action, nonce, signature } = sent[0]!.payload;
    expect(sent[0]!.endpoint).toBe("exchange");
    expect(action).toMatchObject({ type: "order", builder: { b: BUILDER.address.toLowerCase(), f: 50 } });
    const connectionId = createL1ActionHash({ action, nonce });
    const signer = await recoverTypedDataAddress({
      domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
      types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
      primaryType: "Agent",
      message: { source: "b", connectionId },
      signature: { r: signature.r, s: signature.s, v: BigInt(signature.v) },
    });
    expect(signer).toBe(agent.address);
  });

  it("master signs approveAgent / approveBuilderFee / withdraw3 as user-signed testnet actions", async () => {
    const master = privateKeyToAccount(generatePrivateKey());
    const { t, sent } = captureTransport(true, { status: "ok", response: { type: "default" } });
    const ex = masterExchange(t, master, 421614);
    await ex.approveAgent({ agentAddress: privateKeyToAccount(generatePrivateKey()).address, agentName: agentNameWithExpiry(0) });
    await ex.approveBuilderFee({ builder: BUILDER.address as `0x${string}`, maxFeeRate: builderMaxFeeRate(50) });
    await ex.withdraw3({ destination: master.address, amount: "10" });
    const actions = sent.map((s) => s.payload.action);
    expect(actions.map((a) => a.type)).toEqual(["approveAgent", "approveBuilderFee", "withdraw3"]);
    for (const a of actions) expect(a).toMatchObject({ hyperliquidChain: "Testnet", signatureChainId: "0x66eee" });
    expect(actions[0].agentName).toBe(`swellfi valid_until ${90 * 864e5}`);
    expect(actions[1].maxFeeRate).toBe("0.05%");
  });
});
