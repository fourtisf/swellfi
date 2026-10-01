import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { gradFor } from "./tokens";

const disp = (n: string) => (n.includes(":") ? n.slice(n.indexOf(":") + 1) : n);

/** Coin logo from Hyperliquid's CDN with a gradient monogram fallback. */
export function CoinIcon({ name, size = 26 }: { name: string; size?: number }) {
  const [a, b] = gradFor(name);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="ci"
      style={{ width: size, height: size, fontSize: size * 0.38, "--c1": a, "--c2": b } as CSSProperties}
    >
      {disp(name).slice(0, 2)}
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://app.hyperliquid.xyz/coins/${encodeURIComponent(name)}.svg`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function Avatar({ seed, size = 34, ring, src }: { seed: string; size?: number; ring?: boolean; src?: string | null }) {
  const [a, b] = gradFor(seed);
  return (
    <span
      className={`av${ring ? " ring" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.4, "--c1": a, "--c2": b, overflow: src ? "hidden" : undefined } as CSSProperties}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
      ) : (
        (seed[0] ?? "?").toUpperCase()
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

export function Logo({ size = 32, name }: { size?: number; name: string }) {
  return (
    <span className="logo">
      <svg viewBox="0 0 32 32" aria-hidden="true" style={{ width: size, height: size }}>
        <defs>
          <linearGradient id="tl-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2EE09C" />
            <stop offset="1" stopColor="#0E9F62" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="10" fill="url(#tl-logo)" />
        <path d="M5 18.5c3.2 0 3.2-5 6.4-5s3.2 5 6.4 5 3.2-5 6.4-5 2.6 3 2.8 4" stroke="#04140C" strokeWidth="2.7" fill="none" strokeLinecap="round" />
        <path d="M5 24c3.2 0 3.2-3 6.4-3s3.2 3 6.4 3 3.2-3 6.4-3" stroke="#04140C" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".4" />
      </svg>
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
