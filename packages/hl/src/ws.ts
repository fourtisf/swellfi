// Shared Hyperliquid WebSocket: one connection, reference-counted subscriptions,
// automatic resubscribe after reconnect, and a heartbeat so idle sockets stay open.

export type Subscription =
  | { type: "allMids"; dex?: string }
  | { type: "l2Book"; coin: string }
  | { type: "trades"; coin: string }
  | { type: "candle"; coin: string; interval: string }
  | { type: "orderUpdates"; user: string }
  | { type: "userFills"; user: string }
  | { type: "userEvents"; user: string }
  | { type: "clearinghouseState"; user: string; dex?: string }
  | { type: "openOrders"; user: string; dex?: string }
  | { type: "webData3"; user: string };

export interface WsMessage {
  channel: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type WsStatus = "idle" | "connecting" | "open" | "closed";

type Handler = (msg: WsMessage) => void;

interface Entry {
  sub: Subscription;
  handlers: Set<Handler>;
}

export const subKey = (s: Subscription) =>
  JSON.stringify(Object.keys(s).sort().map((k) => [k, (s as Record<string, unknown>)[k]]));

/** Does an incoming message belong to this subscription? */
export function matches(sub: Subscription, msg: WsMessage): boolean {
  if (msg.channel !== (sub.type === "userEvents" ? "user" : sub.type)) return false;
  switch (sub.type) {
    case "l2Book":
      return msg.data?.coin === sub.coin;
    case "trades":
      return Array.isArray(msg.data) && msg.data[0]?.coin === sub.coin;
    case "candle":
      return msg.data?.s === sub.coin && msg.data?.i === sub.interval;
    case "userEvents":
      // userEvents data arrives on channel "user"
      return true;
    case "allMids":
      // Mids from every dex land in one map (HIP-3 keys carry their "dex:" prefix),
      // so each allMids subscriber gets all of them.
      return true;
    default:
      return true;
  }
}

export interface HlSocketOptions {
  url: string;
  /** Injected for tests / non-browser runtimes. */
  WebSocketImpl?: typeof WebSocket;
  heartbeatMs?: number;
  maxBackoffMs?: number;
}

export class HlSocket {
  private ws: WebSocket | null = null;
  private entries = new Map<string, Entry>();
  private statusListeners = new Set<(s: WsStatus) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = true;
  status: WsStatus = "idle";

  constructor(private readonly opts: HlSocketOptions) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  onStatus(fn: (s: WsStatus) => void) {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  /** Subscribe; returns an unsubscribe function. Identical subscriptions share one upstream sub. */
  subscribe(sub: Subscription, handler: Handler): () => void {
    const key = subKey(sub);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { sub, handlers: new Set() };
      this.entries.set(key, entry);
      this.send({ method: "subscribe", subscription: sub });
    }
    entry.handlers.add(handler);
    return () => {
      const e = this.entries.get(key);
      if (!e) return;
      e.handlers.delete(handler);
      if (e.handlers.size === 0) {
        this.entries.delete(key);
        this.send({ method: "unsubscribe", subscription: sub });
      }
    };
  }

  private connect() {
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new Impl(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus("open");
      for (const e of this.entries.values()) this.send({ method: "subscribe", subscription: e.sub });
      this.clearHeartbeat();
      this.heartbeat = setInterval(() => this.send({ method: "ping" }), this.opts.heartbeatMs ?? 30_000);
    };
    ws.onmessage = (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!msg || msg.channel === "pong" || msg.channel === "subscriptionResponse") return;
      for (const e of this.entries.values()) {
        if (!matches(e.sub, msg)) continue;
        for (const h of e.handlers) h(msg);
      }
    };
    ws.onclose = () => {
      this.clearHeartbeat();
      if (this.ws === ws) this.ws = null;
      this.setStatus("closed");
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(this.opts.maxBackoffMs ?? 30_000, 1000 * 2 ** this.attempts++);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private send(o: unknown) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  private clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private setStatus(s: WsStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}
