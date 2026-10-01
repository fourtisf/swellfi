import { describe, expect, it, vi } from "vitest";
import {
  assetIdFor,
  change24h,
  createInfoClient,
  displayName,
  estimateLiqPx,
  estimateOrder,
  HlSocket,
  loadMarkets,
  matches,
  parseMarkets,
  resolveHlConfig,
  subKey,
  tenthsBpsToPercentString,
  tenthsBpsToRate,
} from "./index";
import type { PerpAssetCtx, PerpMeta } from "./types";

const ctx = (markPx: string, prevDayPx: string, extra: Partial<PerpAssetCtx> = {}): PerpAssetCtx => ({
  funding: "0.0000125",
  openInterest: "10",
  prevDayPx,
  dayNtlVlm: "1000000",
  markPx,
  ...extra,
});

describe("config", () => {
  it("defaults to testnet and never silently picks mainnet", () => {
    expect(resolveHlConfig({}).network).toBe("testnet");
    expect(resolveHlConfig({ network: "MAINNET" }).network).toBe("testnet");
    const c = resolveHlConfig({ network: "mainnet" });
    expect(c.network).toBe("mainnet");
    expect(c.infoUrl).toBe("https://api.hyperliquid.xyz/info");
    expect(c.exchangeUrl).toBe("https://api.hyperliquid.xyz/exchange");
  });

  it("can read market data from another network than it trades on", () => {
    const c = resolveHlConfig({ network: "testnet", dataNetwork: "mainnet" });
    expect(c.exchangeUrl).toBe("https://api.hyperliquid-testnet.xyz/exchange");
    expect(c.infoUrl).toBe("https://api.hyperliquid.xyz/info");
    expect(c.wsUrl).toBe("wss://api.hyperliquid.xyz/ws");
  });

  it("parses dexes and builder fee", () => {
    const c = resolveHlConfig({ hip3Dexes: " xyz , ,abc", builderAddress: "0xABC", builderFeeTenthsBps: "50" });
    expect(c.hip3Dexes).toEqual(["xyz", "abc"]);
    expect(c.builder).toEqual({ address: "0xabc", feeTenthsBps: 50 });
  });

  it("converts builder fee units", () => {
    expect(tenthsBpsToRate(50)).toBe(0.0005);
    expect(tenthsBpsToPercentString(50)).toBe("0.05%");
    expect(tenthsBpsToPercentString(1)).toBe("0.001%");
  });
});

describe("markets", () => {
  const meta: PerpMeta = {
    universe: [
      { name: "BTC", szDecimals: 5, maxLeverage: 40 },
      { name: "OLD", szDecimals: 0, maxLeverage: 3, isDelisted: true },
      { name: "ETH", szDecimals: 4, maxLeverage: 25 },
      { name: "ZERO", szDecimals: 0, maxLeverage: 3 },
    ],
  };
  const ctxs = [ctx("100", "80"), ctx("1", "1"), ctx("50", "50", { dayNtlVlm: "5" }), ctx("0", "0")];

  it("drops delisted and unpriced assets and keeps the original index as asset id", () => {
    const l = parseMarkets(meta, ctxs);
    expect(l.map((m) => m.name)).toEqual(["BTC", "ETH"]);
    expect(l[1]!.assetId).toBe(2);
    expect(l[0]!.oi).toBe(1000);
    expect(l[0]!.fund).toBeCloseTo(0.00125);
    expect(change24h(l[0]!)).toBeCloseTo(25);
    expect(change24h(l[0]!, 120)).toBeCloseTo(50);
  });

  it("computes HIP-3 asset ids", () => {
    expect(assetIdFor(0, 7)).toBe(7);
    expect(assetIdFor(1, 0)).toBe(110000);
    expect(assetIdFor(2, 5)).toBe(120005);
    const l = parseMarkets({ universe: [{ name: "xyz:NVDA", szDecimals: 3, maxLeverage: 10 }] }, [ctx("180", "170")], "xyz", 1);
    expect(l[0]).toMatchObject({ kind: "tradfi", dex: "xyz", assetId: 110000 });
    expect(displayName("xyz:NVDA")).toBe("NVDA");
    expect(displayName("BTC")).toBe("BTC");
  });

  it("loads main and HIP-3 dexes sorted by volume", async () => {
    const info = {
      metaAndAssetCtxs: vi.fn(async (dex?: string) =>
        dex === "xyz"
          ? ([{ universe: [{ name: "xyz:GOLD", szDecimals: 2, maxLeverage: 20 }] }, [ctx("3800", "3700", { dayNtlVlm: "9e9" })]] as const)
          : ([meta, ctxs] as const),
      ),
      perpDexs: vi.fn(async () => [null, { name: "xyz" }]),
    };
    const l = await loadMarkets(info as never, ["xyz", "missing"]);
    expect(l.map((m) => m.name)).toEqual(["xyz:GOLD", "BTC", "ETH"]);
    expect(l[0]!.assetId).toBe(110000);
    expect(info.metaAndAssetCtxs).toHaveBeenCalledTimes(2);
  });
});

describe("info client", () => {
  it("retries on 429 and parses candles", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ t: 1, T: 2, s: "BTC", i: "1m", o: "1", c: "2", h: "3", l: "0.5", v: "9", n: 1 }])),
      );
    const c = createInfoClient({ url: "http://x/info", fetch: f, retries: 1 });
    const candles = await c.candleSnapshot("BTC", "1m", 0, 1);
    expect(candles).toEqual([{ t: 1, o: 1, h: 3, l: 0.5, c: 2, v: 9 }]);
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({
      type: "candleSnapshot",
      req: { coin: "BTC", interval: "1m", startTime: 0, endTime: 1 },
    });
  });

  it("does not retry on 4xx", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 422 }));
    const c = createInfoClient({ url: "http://x/info", fetch: f, retries: 3 });
    await expect(c.allMids()).rejects.toThrow("422");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("order estimates", () => {
  it("matches the prototype liquidation formula", () => {
    // long 10x on a 40x asset: 100 * (1 - (0.1 - 0.0125))
    expect(estimateLiqPx("long", 100, 10, 40)).toBeCloseTo(91.25);
    expect(estimateLiqPx("short", 100, 10, 40)).toBeCloseTo(108.75);
    expect(estimateLiqPx("long", 100, 1, 1)).toBeCloseTo(50);
  });

  it("adds the builder fee on top of the exchange fee", () => {
    const e = estimateOrder({ side: "long", type: "market", px: 100, margin: 100, leverage: 10, maxLeverage: 40, builderRate: 0.0005 });
    expect(e.notional).toBe(1000);
    expect(e.fee).toBeCloseTo(1000 * (0.00045 + 0.0005));
    const l = estimateOrder({ side: "long", type: "limit", px: 100, margin: 100, leverage: 10, maxLeverage: 40, builderRate: 0.0005 });
    expect(l.fee).toBeCloseTo(1000 * (0.00015 + 0.0005));
  });
});

class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeWs.instances.push(this);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

describe("HlSocket", () => {
  it("shares subscriptions, routes by coin and resubscribes after reconnect", () => {
    vi.useFakeTimers();
    FakeWs.instances = [];
    const s = new HlSocket({ url: "ws://x", WebSocketImpl: FakeWs as never });
    const a = vi.fn();
    const b = vi.fn();
    const eth = vi.fn();
    const offA = s.subscribe({ type: "l2Book", coin: "BTC" }, a);
    s.subscribe({ type: "l2Book", coin: "BTC" }, b);
    s.subscribe({ type: "l2Book", coin: "ETH" }, eth);
    s.start();
    const ws = FakeWs.instances[0]!;
    ws.open();
    expect(ws.sent.filter((m) => (m as { method: string }).method === "subscribe")).toHaveLength(2);

    ws.emit({ channel: "l2Book", data: { coin: "BTC", levels: [[], []] } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(eth).not.toHaveBeenCalled();

    offA();
    expect(ws.sent.some((m) => (m as { method: string }).method === "unsubscribe")).toBe(false);

    ws.close();
    vi.advanceTimersByTime(1000);
    const ws2 = FakeWs.instances[1]!;
    ws2.open();
    expect(ws2.sent).toEqual([
      { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } },
      { method: "subscribe", subscription: { type: "l2Book", coin: "ETH" } },
    ]);
    s.stop();
    vi.useRealTimers();
  });

  it("matches candle and trades messages", () => {
    expect(matches({ type: "candle", coin: "BTC", interval: "1m" }, { channel: "candle", data: { s: "BTC", i: "1m" } })).toBe(true);
    expect(matches({ type: "candle", coin: "BTC", interval: "1m" }, { channel: "candle", data: { s: "BTC", i: "5m" } })).toBe(false);
    expect(matches({ type: "trades", coin: "ETH" }, { channel: "trades", data: [{ coin: "ETH" }] })).toBe(true);
    expect(subKey({ type: "candle", coin: "BTC", interval: "1m" })).toBe(subKey({ interval: "1m", coin: "BTC", type: "candle" } as never));
  });
});
