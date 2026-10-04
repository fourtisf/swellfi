// Server only (reads files, renders PNGs).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BRAND, HL } from "./env";

/**
 * PnL share cards (1200x630 PNG, the X / Open Graph large-card size), rendered on the server
 * from real data only: indexed trade events, or a live position read from Hyperliquid. Nothing
 * a visitor types ends up on a card, so the swellfi.xyz domain can't vouch for made-up numbers.
 */

const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
export const CARD = { width: 1200, height: 630 };

export interface CardData {
  kind: "close" | "open" | "position";
  handle: string;
  coin: string;
  side: "long" | "short";
  lev?: number;
  /** Net PnL in USD (closes) or unrealized PnL (positions). */
  pnl?: number;
  /** Return on margin, in percent. */
  roe?: number;
  entry?: number;
  /** Exit price (closes) or mark price (positions); the open price for opens. */
  px?: number;
  size?: number;
  at: Date;
  liquidated?: boolean;
}

// ------------------------------------------------------------------ data

type Activity = { id: string; kind: string; user: { handle: string; kind?: string; addressShort: string }; data: Record<string, unknown>; createdAt: string };

export async function activityById(id: string): Promise<Activity | null> {
  const r = await fetch(`${API}/api/activity/${encodeURIComponent(id)}`, { next: { revalidate: 60 } }).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json()) as { item: Activity }).item;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function cardFromActivity(a: Activity): CardData | null {
  if (a.kind !== "open" && a.kind !== "close") return null;
  const d = a.data;
  const side = d.side === "short" ? "short" : "long";
  const lev = num(d.lev);
  const pnl = num(d.pnl);
  const entry = num(d.entry);
  const exit = num(d.exit) ?? num(d.px);
  const sz = num(d.sz);
  // Return on the margin put up at entry, when the leverage is known.
  const margin = entry && sz && lev ? (entry * sz) / lev : undefined;
  const handle = a.user.kind && a.user.kind !== "member" ? a.user.addressShort : a.user.handle;
  return {
    kind: a.kind,
    handle,
    coin: String(d.coin ?? ""),
    side,
    lev,
    pnl: a.kind === "close" ? pnl : undefined,
    roe: a.kind === "close" && pnl != null && margin ? (pnl / margin) * 100 : undefined,
    entry: a.kind === "close" ? entry : undefined,
    px: exit,
    size: num(d.size),
    at: new Date(a.createdAt),
    liquidated: d.liquidated === true,
  };
}

/** A member's open position, straight from Hyperliquid (public account data). */
export async function livePosition(handle: string, coin: string): Promise<CardData | null> {
  const ur = await fetch(`${API}/api/users/${encodeURIComponent(handle)}`, { next: { revalidate: 60 } }).catch(() => null);
  if (!ur?.ok) return null;
  const { user } = (await ur.json()) as { user: { address: string; handle: string } };
  const dex = coin.includes(":") ? coin.split(":")[0] : "";
  const r = await fetch(HL.infoUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(dex ? { type: "clearinghouseState", user: user.address, dex } : { type: "clearinghouseState", user: user.address }),
    next: { revalidate: 15 },
  }).catch(() => null);
  if (!r?.ok) return null;
  type P = { coin: string; szi: string; entryPx: string; positionValue: string; unrealizedPnl: string; returnOnEquity: string; leverage: { value: number } };
  const ch = (await r.json()) as { assetPositions?: { position: P }[] };
  const p = ch.assetPositions?.map((x) => x.position).find((x) => x.coin === coin && Number(x.szi) !== 0);
  if (!p) return null;
  const szi = Number(p.szi);
  return {
    kind: "position",
    handle: user.handle,
    coin,
    side: szi > 0 ? "long" : "short",
    lev: p.leverage?.value,
    pnl: Number(p.unrealizedPnl),
    roe: Number(p.returnOnEquity) * 100,
    entry: Number(p.entryPx),
    px: Math.abs(Number(p.positionValue) / szi),
    size: Math.abs(Number(p.positionValue)),
    at: new Date(),
  };
}

// ------------------------------------------------------------------ formatting

const disp = (coin: string) => (coin.includes(":") ? coin.split(":")[1]! : coin);
function fPx(p?: number) {
  if (p == null || !Number.isFinite(p)) return "—";
  const a = Math.abs(p);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fUsd = (v: number) => `${v < 0 ? "−" : "+"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fPct = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(Math.abs(v) >= 100 ? 0 : 1)}%`;
const fSize = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
const fDate = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

// ------------------------------------------------------------------ assets

const ROOT = process.cwd();
let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 700 | 800 }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(ROOT, "assets/fonts/Inter-Medium.ttf")).then((data) => ({ name: "Inter", data, weight: 500 as const })),
    readFile(path.join(ROOT, "assets/fonts/Inter-Bold.ttf")).then((data) => ({ name: "Inter", data, weight: 700 as const })),
    readFile(path.join(ROOT, "assets/fonts/InterTight-ExtraBold.ttf")).then((data) => ({ name: "Inter Tight", data, weight: 800 as const })),
  ]);
  return fonts;
}
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
async function fileUri(rel: string) {
  try {
    return svgUri(await readFile(path.join(ROOT, rel), "utf8"));
  } catch {
    return null;
  }
}
const coinLogo = (coin: string) => {
  let s = disp(coin).toUpperCase();
  if (/^K[A-Z0-9]{2,}$/.test(s) && disp(coin).startsWith("k")) s = s.slice(1);
  return fileUri(`public/logos/${s.replace(/[^A-Z0-9$]/g, "")}.svg`);
};

// Deterministic avatar colors.
function hue(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
function hsl(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ------------------------------------------------------------------ the card

export async function renderCard(c: CardData, opts: { amounts: boolean }) {
  const [fontList, brandIcon, logo] = await Promise.all([loadFonts(), fileUri("src/app/icon.svg"), coinLogo(c.coin)]);
  const up = (c.pnl ?? 0) >= 0;
  const accent = c.kind === "open" ? "#4DB5FF" : up ? "#19D08B" : "#FF5A67";
  const long = c.side === "long";
  const h = hue(c.handle);
  const tag = c.kind === "close" ? (c.liquidated ? "LIQUIDATED" : "CLOSED") : c.kind === "position" ? "OPEN POSITION" : "OPENED";

  // Headline: ROE when known; otherwise PnL; for opens, the position size (or the side).
  let big: string;
  let small: string | null = null;
  if (c.kind === "open") {
    big = `${long ? "Long" : "Short"}${c.lev ? ` ${c.lev}x` : ""}`;
    small = opts.amounts && c.size ? `${fSize(c.size)} at ${fPx(c.px)}` : `at ${fPx(c.px)}`;
  } else if (c.roe != null && Number.isFinite(c.roe)) {
    big = fPct(c.roe);
    small = opts.amounts && c.pnl != null ? `${fUsd(c.pnl)} ${c.kind === "position" ? "unrealized" : "PnL"}` : null;
  } else {
    big = opts.amounts && c.pnl != null ? fUsd(c.pnl) : c.entry && c.px ? fPct(((c.px - c.entry) / c.entry) * 100 * (long ? 1 : -1)) : "—";
  }

  // A soft wave behind the numbers, rising for wins, falling for losses.
  // Kept between y 190 and 450, clear of the name and date at the bottom right.
  const [y0, y1] = up ? [420, 210] : [230, 430];
  const wave = Array.from({ length: 41 }, (_, i) => {
    const x = 520 + i * 17;
    const y = y0 + (y1 - y0) * (i / 40) + Math.sin(i * 0.55) * 20 + Math.sin(i * 1.7) * 8;
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join("");
  // Fades in from the left (a mask, so the background glow behind it stays untouched).
  const waveSvg = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".26"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient><linearGradient id="f" x1="520" y1="0" x2="760" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient><mask id="m"><rect width="1200" height="630" fill="url(#f)"/></mask></defs><g mask="url(#m)"><path d="${wave}L1220,630L520,630Z" fill="url(#g)"/><path d="${wave}" fill="none" stroke="${accent}" stroke-width="4" stroke-linejoin="round" stroke-opacity=".9"/></g></svg>`,
  );

  const pill = (text: string, color: string, bg: string) => (
    <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: bg, color, fontSize: 26, fontWeight: 700 }}>{text}</div>
  );
  const kv = (k: string, v: string) => (
    <div style={{ display: "flex", flexDirection: "column", marginRight: 54 }}>
      <div style={{ fontSize: 20, color: "#7D8CA3", fontWeight: 500, letterSpacing: 2 }}>{k}</div>
      <div style={{ fontSize: 34, color: "#EAF1FA", fontWeight: 700, marginTop: 6 }}>{v}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Inter", color: "#EAF1FA", background: "#04070D" }}>
        <div style={{ position: "absolute", left: -260, top: -380, width: 1100, height: 1100, borderRadius: 9999, background: "radial-gradient(circle, rgba(47,134,240,0.30), rgba(47,134,240,0) 62%)" }} />
        <div style={{ position: "absolute", right: -300, bottom: -460, width: 1000, height: 1000, borderRadius: 9999, background: `radial-gradient(circle, ${accent}2E, rgba(0,0,0,0) 60%)` }} />
        <img alt="" src={waveSvg} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0 }} />


        <div style={{ display: "flex", flexDirection: "column", padding: "52px 64px", width: "100%", height: "100%" }}>
          {/* top row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {brandIcon && <img alt="" src={brandIcon} width={52} height={52} />}
              <div style={{ fontFamily: "Inter Tight", fontWeight: 800, fontSize: 40, marginLeft: 14, letterSpacing: -1.5 }}>{BRAND}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 18px", borderRadius: 999, border: `1.5px solid ${accent}88`, background: `${accent}1F`, color: accent, fontSize: 20, fontWeight: 700, letterSpacing: 3 }}>
              {tag}
            </div>
          </div>

          {/* market */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 54 }}>
            {logo ? (
              <img alt="" src={logo} width={64} height={64} style={{ borderRadius: 999 }} />
            ) : (
              <div style={{ display: "flex", width: 64, height: 64, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "#1B2A40", fontSize: 30, fontWeight: 700 }}>{disp(c.coin).slice(0, 1)}</div>
            )}
            <div style={{ fontFamily: "Inter Tight", fontWeight: 800, fontSize: 52, marginLeft: 18, marginRight: 22, letterSpacing: -1.5 }}>{disp(c.coin)}</div>
            {pill(long ? "Long" : "Short", long ? "#3BE3A2" : "#FF6B76", long ? "rgba(25,208,139,0.16)" : "rgba(234,57,67,0.16)")}
            {c.lev && c.kind !== "open" ? <div style={{ display: "flex", marginLeft: 12 }}>{pill(`${c.lev}x`, "#C9D5E3", "rgba(255,255,255,0.08)")}</div> : null}
          </div>

          {/* the number */}
          <div style={{ display: "flex", fontFamily: "Inter Tight", fontWeight: 800, fontSize: 150, lineHeight: 1, letterSpacing: -6, color: accent, marginTop: 26 }}>{big}</div>
          {small && <div style={{ display: "flex", fontSize: 34, fontWeight: 700, color: "#C9D5E3", marginTop: 10 }}>{small}</div>}

          {/* prices */}
          <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex" }}>
              {c.kind !== "open" && kv("ENTRY", fPx(c.entry))}
              {c.kind !== "open" && kv(c.kind === "position" ? "MARK" : "EXIT", fPx(c.px))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", width: 44, height: 44, borderRadius: 999, background: `linear-gradient(135deg, ${hsl(h, 0.8, 0.62)}, ${hsl((h + 70) % 360, 0.75, 0.5)})` }} />
                <div style={{ fontSize: 30, fontWeight: 700, marginLeft: 14 }}>{c.handle}</div>
              </div>
              <div style={{ display: "flex", fontSize: 20, color: "#7D8CA3", fontWeight: 500, marginTop: 10 }}>{`${fDate(c.at)} · swellfi.xyz`}</div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...CARD,
      fonts: fontList.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: "normal" as const })),
      headers: { "Cache-Control": c.kind === "position" ? "public, max-age=30, s-maxage=30" : "public, max-age=600, s-maxage=3600" },
    },
  );
}
