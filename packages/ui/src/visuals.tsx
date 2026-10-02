import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { gradFor } from "./tokens";

const disp = (n: string) => (n.includes(":") ? n.slice(n.indexOf(":") + 1) : n);

// ---- Coin logos ----
// Resolution order (first that loads wins): bundled logo (instant, offline) → Hyperliquid's
// coin CDN (covers every listed token) → monogram. HYPE prefers Hyperliquid's official mark.
let bundled: ReadonlySet<string> = new Set();
let bundledBase = "/logos";
export function configureCoinLogos(opts: { bundled: ReadonlySet<string>; base?: string }) {
  bundled = opts.bundled;
  if (opts.base) bundledBase = opts.base;
}

const symbolOf = (name: string) => {
  let s = disp(name).toUpperCase();
  // Hyperliquid "k" prefixes (kPEPE = 1000 PEPE) share the base token's logo.
  if (/^k[A-Z0-9]{2,}$/.test(disp(name))) s = s.slice(1);
  return s;
};

const CDN_FIRST = new Set(["HYPE", "PURR"]);

export function coinLogoSources(name: string): string[] {
  const sym = symbolOf(name);
  const local = bundled.has(sym) ? [`${bundledBase}/${encodeURIComponent(sym)}.svg`] : [];
  const cdn = [`https://app.hyperliquid.xyz/coins/${encodeURIComponent(name)}.svg`];
  return CDN_FIRST.has(sym) ? [...cdn, ...local] : [...local, ...cdn];
}

/** Coin / market logo with graceful fallbacks; a gradient monogram if nothing loads. */
export function CoinIcon({ name, size = 26 }: { name: string; size?: number }) {
  return <CoinIconInner key={name} name={name} size={size} />;
}

function CoinIconInner({ name, size }: { name: string; size: number }) {
  const [a, b] = gradFor(name);
  const sources = coinLogoSources(name);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[idx];
  // A slow remote source shouldn't leave a monogram on screen: move on after 2.5 s. Bundled
  // logos are exempt: they're same-origin and tiny, and with lazy loading an off-screen one
  // hasn't even started yet, so the timer would skip it before it could load.
  const isLocal = src?.startsWith(`${bundledBase}/`) ?? false;
  useEffect(() => {
    if (loaded || isLocal || idx >= sources.length - 1) return;
    const t = setTimeout(() => setIdx((i) => (i === idx ? i + 1 : i)), 2500);
    return () => clearTimeout(t);
  }, [idx, loaded, isLocal, sources.length]);
  return (
    <span
      className={`ci${loaded ? " has-img" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.36, "--c1": a, "--c2": b } as CSSProperties}
      title={disp(name)}
    >
      {!loaded && disp(name).slice(0, disp(name).length <= 3 ? 3 : 2)}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setIdx((i) => i + 1);
          }}
          style={loaded ? undefined : { opacity: 0 }}
        />
      )}
    </span>
  );
}

const MARBLE = ["#4DB5FF", "#1D5FD1", "#1C6FA8", "#5B45E0", "#2BB3C0", "#E07A5F", "#F2C14E", "#B8326A", "#7A4FD0", "#9AF1FF"];

/** Generative "marble" avatar (deterministic per seed) unless an image is set. */
export function Avatar({ seed, size = 34, ring, src }: { seed: string; size?: number; ring?: boolean; src?: string | null }) {
  const id = useId().replace(/:/g, "");
  const h = [...seed].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381);
  const pick = (n: number) => MARBLE[(h >>> (n * 3)) % MARBLE.length]!;
  const r = (n: number, m: number) => ((h >>> n) % m) - m / 2;
  return (
    <span className={`av marble${ring ? " ring" : ""}`} style={{ width: size, height: size } as CSSProperties} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
      ) : (
        <svg viewBox="0 0 80 80" width={size} height={size}>
          <defs>
            <filter id={`b${id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <clipPath id={`c${id}`}>
              <circle cx="40" cy="40" r="40" />
            </clipPath>
          </defs>
          <g clipPath={`url(#c${id})`}>
            <rect width="80" height="80" fill={pick(0)} />
            <g filter={`url(#b${id})`}>
              <path d={`M32 ${10 + r(3, 20)}c${18 + r(5, 10)} 0 ${30 + r(7, 12)} 14 ${30} 34s-14 30-34 30S-6 60-6 40 ${14} ${10 + r(3, 20)} 32 ${10 + r(3, 20)}z`} fill={pick(1)} transform={`rotate(${(h % 360)} 40 40)`} />
              <circle cx={40 + r(9, 40)} cy={40 + r(11, 40)} r={16 + (h % 10)} fill={pick(2)} />
              <circle cx={40 + r(13, 36)} cy={40 + r(15, 36)} r={10 + ((h >>> 4) % 8)} fill={pick(3)} opacity=".85" />
            </g>
          </g>
        </svg>
      )}
    </span>
  );
}

export interface SparklineProps {
  data: number[] | null | undefined;
  width: number;
  height: number;
  color?: string | null;
  fill?: number;
  strokeWidth?: number;
  full?: boolean;
  className?: string;
}

/** Area sparkline (prototype `area()`): green when the series ends higher, red otherwise. */
export function Sparkline({ data, width: w, height: h, color, fill = 0.32, strokeWidth = 1.7, full, className }: SparklineProps) {
  const id = useId().replace(/:/g, "");
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const r = mx - mn || 1;
  const up = data[data.length - 1]! >= data[0]!;
  const c = color || (up ? "#16C784" : "#EA3943");
  const line = data
    .map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - mn) / r) * (h - 8)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      className={className}
      width={full ? "100%" : w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity={fill} />
          <stop offset="1" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h}Z`} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={c} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// Tide Coin: a disc split by one sine wave, light aqua over deep blue, with a transparent gap.
const TIDE_WAVE = Array.from({ length: 25 }, (_, i) => {
  const x = 8 + i * 2;
  return `${x} ${(32 + 5.2 * Math.sin(((x - 10) / 44) * 2 * Math.PI)).toFixed(2)}`;
}).join("L");

/** The Swellfi mark on its own (no wordmark). */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="10 10 44 44" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} gradientUnits="userSpaceOnUse" x1="12" y1="8" x2="52" y2="58">
          <stop offset="0" stopColor="#9AF1FF" />
          <stop offset=".6" stopColor="#3FA9FF" />
          <stop offset="1" stopColor="#1D5FD1" />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <circle cx="32" cy="32" r="22" />
        </clipPath>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="10" y="10" width="44" height="44">
          <rect x="10" y="10" width="44" height="44" fill="#fff" />
          <path d={`M${TIDE_WAVE}`} fill="none" stroke="#000" strokeWidth="2.6" />
        </mask>
      </defs>
      <g clipPath={`url(#c${id})`} mask={`url(#m${id})`}>
        <path d={`M${TIDE_WAVE}L56 8L8 8Z`} fill={`url(#g${id})`} />
        <path d={`M${TIDE_WAVE}L56 56L8 56Z`} fill="#1D5FD1" />
      </g>
    </svg>
  );
}

export function Logo({ size = 30, name }: { size?: number; name: string }) {
  return (
    <span className="logo">
      <BrandMark size={size} />
      {name}
    </span>
  );
}

export function Risk({ n }: { n: number }) {
  return (
    <span className="risk" title={`Risk ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

export function Empty({ icon, title, children, style }: { icon?: ReactNode; title: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="empty" style={style}>
      {icon && <div className="ico">{icon}</div>}
      <b>{title}</b>
      {children}
    </div>
  );
}

/** Shimmer placeholder while data loads. */
export function Skel({ w = "md" }: { w?: "md" | "lg" | "xl" }) {
  return <span className={`sk${w === "md" ? "" : ` w-${w}`}`} aria-hidden="true" />;
}

export function SkelRows({ n = 5 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="skrow" key={i}>
          <span className="sk c" />
          <span className="grow">
            <span className="sk w-lg" />
            <span className="sk" />
          </span>
          <span className="sk w-lg" />
        </div>
      ))}
    </>
  );
}
