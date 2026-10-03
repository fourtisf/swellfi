// Client for our own API (/api/*). Nginx (prod) or Next rewrites (dev) route it to Fastify.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let getToken: () => Promise<string | null> = async () => null;

/** Wired up by the session provider so every request carries the Privy access token. */
export function setTokenGetter(fn: () => Promise<string | null>) {
  getToken = fn;
}

export async function api<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const token = await getToken().catch(() => null);
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    ...(init.keepalive ? { keepalive: true } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "ERROR", data.message ?? `Request failed (${res.status})`);
  return data as T;
}

// ---- Response types (mirror apps/api) ----

export interface PublicUser {
  id: string;
  handle: string;
  address: string;
  addressShort: string;
  avatarUrl: string | null;
  bio: string | null;
  xHandle: string | null;
  xVerified: boolean;
  /** member: on Swellfi. top: Hyperliquid leaderboard trader. external: other Hyperliquid address (whale trades). */
  kind?: "member" | "top" | "external";
}

/** Members by handle; Hyperliquid traders who aren't on Swellfi by their short address. */
export const userName = (u: Pick<PublicUser, "handle" | "addressShort" | "kind">) => (u.kind && u.kind !== "member" ? u.addressShort : u.handle);

export interface Summary {
  pnl: string;
  roi: number;
  volume: string;
  equity: string;
  trades: number;
  winRate: number | null;
  maxDrawdown: number;
  series: number[];
}

export interface LeaderRow extends Summary {
  rank: number;
  user: PublicUser;
  followers: number;
  isFollowing: boolean;
}

export type Timeframe = "24h" | "7d" | "30d" | "all";

export interface Fund {
  id: string;
  name: string;
  vaultAddress: string | null;
  strategy: string;
  manager: PublicUser;
  perfFeePct: number;
  risk: number;
  minDeposit: string;
  aum: string;
  members: number;
  return30d: number;
  maxDrawdown: number;
  series: number[];
}

export interface ActivityItem {
  id: string;
  kind: "open" | "close" | "whale" | "verify" | "follow" | "fund";
  user: PublicUser;
  data: {
    coin?: string;
    /** long/short for trades; buy/sell (the taker's side) for whale trades. */
    side?: "long" | "short" | "buy" | "sell";
    lev?: number;
    size?: number;
    px?: number;
    pnl?: number;
    xHandle?: string;
    handle?: string;
    roi30d?: number;
    fundId?: string;
    fundName?: string;
    amount?: number;
    members?: number;
    return30d?: number;
    /** Indexed trades: coins traded, entry/exit for closes. */
    sz?: number;
    entry?: number;
    exit?: number;
    liquidated?: boolean;
  };
  createdAt: string;
  likes?: number;
  liked?: boolean;
  mine?: boolean;
  isFollowing?: boolean;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface PostPosition {
  coin: string;
  side: "long" | "short";
  lev: number;
  entry: number;
}

export interface FeedPost {
  id: string;
  user: PublicUser;
  text: string;
  position: PostPosition | null;
  likes: number;
  replies: number;
  createdAt: string;
  liked: boolean;
  mine: boolean;
  isFollowing: boolean;
}

export interface ChatMsg {
  id: string;
  text: string;
  createdAt: string;
  user: PublicUser;
}

export interface Tier {
  name: string;
  minVolume: number;
  rebatePct: number;
  referralPct: number;
}

export interface Me {
  user: PublicUser & { referralCode: string; isPublic: boolean };
  isAdmin: boolean;
  referralLink: string;
}
