import type { Candle, CandleInterval, L2Book, MetaAndAssetCtxs, PerpDex, RawCandle } from "./types";

export class HlInfoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HlInfoError";
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface InfoClientOptions {
  url: string;
  fetch?: FetchLike;
  /** Retries on 429 / 5xx / network errors, with exponential backoff. */
  retries?: number;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thin client for POST /info. Read-only: nothing here needs a signature. */
export function createInfoClient({ url, fetch: f = fetch, retries = 2, timeoutMs = 10_000 }: InfoClientOptions) {
  async function post<T>(body: Record<string, unknown>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(400 * 2 ** (attempt - 1));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await f(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (res.ok) return (await res.json()) as T;
        lastErr = new HlInfoError(`info ${String(body.type)} failed: ${res.status}`, res.status);
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    post,
    /** Perp universe + live contexts. Pass `dex` for a HIP-3 perp dex. */
    metaAndAssetCtxs: (dex?: string) =>
      post<MetaAndAssetCtxs>(dex ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" }),
    perpDexs: () => post<PerpDex[]>({ type: "perpDexs" }),
    allMids: (dex?: string) =>
      post<Record<string, string>>(dex ? { type: "allMids", dex } : { type: "allMids" }),
    l2Book: (coin: string) => post<L2Book>({ type: "l2Book", coin }),
    candleSnapshot: async (coin: string, interval: CandleInterval, startTime: number, endTime: number) =>
      (
        await post<RawCandle[]>({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } })
      ).map(toCandle),
  };
}

export type InfoClient = ReturnType<typeof createInfoClient>;

export const toCandle = (k: Pick<RawCandle, "t" | "o" | "h" | "l" | "c" | "v">): Candle => ({
  t: k.t,
  o: +k.o,
  h: +k.h,
  l: +k.l,
  c: +k.c,
  v: +k.v,
});
