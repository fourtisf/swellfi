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
  const open = c.kind === "open";
  // Accent: brand blue for opens, green / red for results.
  const [acc, accSoft, accDeep] = open ? ["#5CC2FF", "#9AF1FF", "#2F86F0"] : up ? ["#21E0A0", "#8CF5CF", "#0E9F6E"] : ["#FF5C6C", "#FFA3AD", "#C8283A"];
  const long = c.side === "long";
  const h = hue(c.handle);
  const tag = c.kind === "close" ? (c.liquidated ? "LIQUIDATED" : "CLOSED") : c.kind === "position" ? "LIVE POSITION" : "OPENED";

  // The headline number.
  let big: string;
  let label: string;
  let sub: string | null = null;
  if (open) {
    big = `${long ? "Long" : "Short"}${c.lev ? ` ${c.lev}x` : ""}`;
    label = "NEW POSITION";
    sub = null;
  } else if (c.roe != null && Number.isFinite(c.roe)) {
    big = fPct(c.roe);
    label = c.kind === "position" ? "UNREALIZED ROE" : "ROE";
    sub = opts.amounts && c.pnl != null ? fUsd(c.pnl) : null;
  } else if (opts.amounts && c.pnl != null) {
    big = fUsd(c.pnl);
    label = c.kind === "position" ? "UNREALIZED PNL" : "REALIZED PNL";
  } else {
    big = c.entry && c.px ? fPct(((c.px - c.entry) / c.entry) * 100 * (long ? 1 : -1)) : "—";
    label = "PRICE MOVE";
  }
  const bigSize = big.length > 8 ? 128 : big.length > 6 ? 150 : 168;

  // Layered swell: three ribbons rising to the right for wins (falling for losses), on brand.
  const ribbon = (base: number, amp: number, k: number, ph: number, tilt: number) => {
    let d = "";
    for (let i = 0; i <= 48; i++) {
      const x = 380 + i * 18;
      const y = base - (i / 48) * tilt + Math.sin(i * k + ph) * amp + Math.sin(i * k * 2.3 + ph * 1.7) * amp * 0.3;
      d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    return d;
  };
  const tilt = open ? 60 : up ? 120 : -40;
  const waves = [
    // Losses fall to the right, so they start higher to stay above the footer.
    { d: ribbon(up || open ? 470 : 420, 16, 0.22, 0.4, tilt * 0.6), o: 0.12 },
    { d: ribbon(up || open ? 500 : 445, 20, 0.19, 1.6, tilt * 0.85), o: 0.18 },
    { d: ribbon(up || open ? 525 : 465, 14, 0.25, 2.8, tilt), o: 0.3 },
  ];
  // Ripples around the right side: the "swell".
  const rings = [130, 200, 270, 340, 410, 480].map((r, i) => `<circle cx="1010" cy="250" r="${r}" fill="none" stroke="${i % 2 ? accSoft : acc}" stroke-opacity="${(0.16 - i * 0.022).toFixed(3)}" stroke-width="${i ? 1.5 : 2}"/>`).join("");
  const art = svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
      <defs>
        <radialGradient id="gm" cx="84%" cy="40%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <mask id="m"><rect width="1200" height="630" fill="url(#gm)"/></mask>
        <linearGradient id="fx" x1="380" y1="0" x2="760" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <mask id="mx"><rect width="1200" height="630" fill="url(#fx)"/></mask>
        <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${acc}"/><stop offset="1" stop-color="${accDeep}" stop-opacity="0"/></linearGradient>
        <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accSoft}" stop-opacity="0"/><stop offset=".6" stop-color="${accSoft}"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
      </defs>
      <g mask="url(#m)">${rings}</g>
      <g mask="url(#mx)">
        ${waves.map((w) => `<path d="${w.d}L1250,700L380,700Z" fill="url(#w)" fill-opacity="${w.o}"/>`).join("")}
        <path d="${waves[2]!.d}" fill="none" stroke="url(#hl)" stroke-width="3.5" stroke-linejoin="round"/>
      </g>
    </svg>`,
  );

  const chip = (text: string, color: string, bg: string, border: string) => (
    <div style={{ display: "flex", alignItems: "center", padding: "7px 16px", borderRadius: 999, background: bg, border: `1.5px solid ${border}`, color, fontSize: 22, fontWeight: 700 }}>{text}</div>
  );
  const stat = (k: string, v: string, last = false) => (
    <div style={{ display: "flex", flexDirection: "column", paddingRight: 34, marginRight: 34, borderRight: last ? "none" : "1.5px solid rgba(255,255,255,0.10)" }}>
      <div style={{ display: "flex", fontSize: 15, color: "#7F90A8", fontWeight: 700, letterSpacing: 2.4 }}>{k}</div>
      <div style={{ display: "flex", fontSize: 28, color: "#F2F7FD", fontWeight: 700, marginTop: 6 }}>{v}</div>
    </div>
  );
  const stats: [string, string][] = [];
  if (!open) {
    stats.push(["ENTRY", fPx(c.entry)], [c.kind === "position" ? "MARK" : "EXIT", fPx(c.px)]);
  } else stats.push(["ENTRY", fPx(c.px)]);
  // Opens already say the leverage in the headline.
  if (c.lev && !open) stats.push(["LEVERAGE", `${c.lev}x`]);
  if (opts.amounts && c.size) stats.push(["SIZE", fSize(c.size)]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", fontFamily: "Inter", color: "#EAF1FA", background: "linear-gradient(140deg, #071225 0%, #050A15 48%, #03060C 100%)", overflow: "hidden" }}>
        {/* aurora */}
        <div style={{ position: "absolute", left: -280, top: -420, width: 1000, height: 1000, borderRadius: 9999, background: "radial-gradient(circle, rgba(47,134,240,0.42), rgba(47,134,240,0) 62%)" }} />
        <div style={{ position: "absolute", left: 520, top: -380, width: 760, height: 760, borderRadius: 9999, background: "radial-gradient(circle, rgba(154,241,255,0.13), rgba(154,241,255,0) 62%)" }} />
        <div style={{ position: "absolute", left: 600, top: 120, width: 900, height: 900, borderRadius: 9999, background: `radial-gradient(circle, ${acc}40, ${acc}00 60%)` }} />
        <img alt="" src={art} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0 }} />
        {/* coin medallion in the ripples */}
        <div style={{ position: "absolute", left: 1010 - 92, top: 250 - 92, width: 184, height: 184, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: `linear-gradient(140deg, ${accSoft}, ${accDeep})`, boxShadow: `0 0 90px ${acc}66, 0 30px 60px rgba(0,0,0,0.5)` }}>
          <div style={{ display: "flex", width: 172, height: 172, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 35% 30%, #16233A, #070C17 70%)" }}>
            {logo ? (
              <img alt="" src={logo} width={112} height={112} style={{ borderRadius: 999 }} />
            ) : (
              <div style={{ display: "flex", fontFamily: "Inter Tight", fontWeight: 800, fontSize: 72, color: accSoft }}>{disp(c.coin).slice(0, 1)}</div>
            )}
          </div>
        </div>
        {/* edge highlight */}
        <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 2, background: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))" }} />

        <div style={{ display: "flex", flexDirection: "column", padding: "48px 60px 46px", width: "100%", height: "100%", position: "relative" }}>
          {/* header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {brandIcon && <img alt="" src={brandIcon} width={46} height={46} />}
              <div style={{ display: "flex", fontFamily: "Inter Tight", fontWeight: 800, fontSize: 34, marginLeft: 12, letterSpacing: -1.2 }}>{BRAND}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", padding: "9px 18px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.12)", fontSize: 16, fontWeight: 700, letterSpacing: 3, color: "#C9D5E3" }}>
              <div style={{ display: "flex", width: 10, height: 10, borderRadius: 99, background: acc, boxShadow: `0 0 14px ${acc}`, marginRight: 10 }} />
              {tag}
            </div>
          </div>

          {/* market */}
          <div style={{ display: "flex", alignItems: "center", marginTop: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: 22 }}>
              <div style={{ display: "flex", fontFamily: "Inter Tight", fontWeight: 800, fontSize: 46, letterSpacing: -1.5, lineHeight: 1 }}>{`${disp(c.coin)}-PERP`}</div>
              <div style={{ display: "flex", fontSize: 17, color: "#7F90A8", fontWeight: 500, marginTop: 6 }}>Perpetual · Hyperliquid</div>
            </div>
            {chip(long ? "Long" : "Short", long ? "#4BEAAE" : "#FF7A86", long ? "rgba(25,208,139,0.14)" : "rgba(234,57,67,0.14)", long ? "rgba(25,208,139,0.45)" : "rgba(234,57,67,0.45)")}
            {c.lev && !open ? <div style={{ display: "flex", marginLeft: 10 }}>{chip(`${c.lev}x`, "#DCE6F2", "rgba(255,255,255,0.06)", "rgba(255,255,255,0.16)")}</div> : null}
          </div>

          {/* headline */}
          <div style={{ display: "flex", fontSize: 16, fontWeight: 700, letterSpacing: 3.2, color: "#7F90A8", marginTop: 34 }}>{label}</div>
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 4 }}>
            <div style={{ display: "flex", fontFamily: "Inter Tight", fontWeight: 800, fontSize: bigSize, lineHeight: 0.92, letterSpacing: -7, color: acc, textShadow: `0 0 60px ${acc}66` }}>{big}</div>
            {sub && (
              <div style={{ display: "flex", alignItems: "center", marginLeft: 26, marginBottom: 14, padding: "10px 18px", borderRadius: 16, background: `${acc}18`, border: `1.5px solid ${acc}55`, color: accSoft, fontSize: 30, fontWeight: 700 }}>{sub}</div>
            )}
          </div>

          {/* glass footer */}
          <div style={{ display: "flex", marginTop: "auto", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderRadius: 22, background: "linear-gradient(180deg, rgba(20,30,48,0.92), rgba(10,16,28,0.94))", border: "1.5px solid rgba(255,255,255,0.12)", boxShadow: "0 24px 70px rgba(0,0,0,0.55)" }}>
            <div style={{ display: "flex" }}>{stats.map(([k, v], i) => stat(k, v, i === stats.length - 1))}</div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", width: 46, height: 46, borderRadius: 999, background: `linear-gradient(135deg, ${hsl(h, 0.8, 0.64)}, ${hsl((h + 70) % 360, 0.75, 0.48)})`, border: "2px solid rgba(255,255,255,0.25)" }} />
              <div style={{ display: "flex", flexDirection: "column", marginLeft: 14 }}>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 700 }}>{c.handle}</div>
                <div style={{ display: "flex", fontSize: 15, color: "#7F90A8", fontWeight: 500, marginTop: 4 }}>{`${fDate(c.at)} · swellfi.xyz`}</div>
              </div>
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
