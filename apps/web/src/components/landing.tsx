"use client";

import { displayName, type Market } from "@swellfi/hl";
import { BrandMark, CoinIcon, fUsd, Icon, Skel, Sparkline, type IconName } from "@swellfi/ui";
import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";
import { BRAND, BUILDER_RATE, HL } from "@/lib/env";
import { loadSparks, useMarkets } from "@/lib/market";
import { tradeHref } from "@/lib/routes";
import { LiveChg, LivePx } from "./live";

// Landing sections for the home page. Everything shown is live market data or a plain
// statement about how the product works; nothing here is a made-up trade or user.

/** Wave lines + aurora behind the hero. Decorative only. */
export function HeroBackdrop() {
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 250 + i * 34;
    const a = 34 + i * 7;
    return `M-40 ${y} C 240 ${y - a}, 480 ${y + a}, 720 ${y} S 1200 ${y - a}, 1480 ${y}`;
  });
  return (
    <div className="lp-bg" aria-hidden="true">
      <i className="lp-aur a1" />
      <i className="lp-aur a2" />
      <i className="lp-aur a3" />
      <svg className="lp-waves" viewBox="0 0 1440 560" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-wave" x1="0" x2="1">
            <stop offset="0" stopColor="#4DB5FF" stopOpacity="0" />
            <stop offset=".45" stopColor="#9AF1FF" stopOpacity=".55" />
            <stop offset="1" stopColor="#2F86F0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {lines.map((d, i) => (
          <path key={i} d={d} stroke="url(#lp-wave)" strokeWidth={i === 3 ? 1.6 : 1} fill="none" opacity={1 - Math.abs(i - 3) * 0.22} />
        ))}
      </svg>
      <i className="lp-grid" />
    </div>
  );
}

function useShowcase() {
  const markets = useMarkets((s) => s.markets);
  return useMemo(() => {
    const lead = markets.find((m) => m.name === "BTC") ?? markets[0];
    const tradfi = markets.filter((m) => m.kind === "tradfi").slice(0, 3);
    return { lead, tradfi };
  }, [markets]);
}

/** Product shot built from live data: a market card, stocks & commodities, and the custody model. */
export function HeroShowcase() {
  const { lead, tradfi } = useShowcase();
  const spark = useMarkets((s) => (lead ? s.spark[lead.name] : undefined));
  useEffect(() => {
    if (lead) void loadSparks([lead.name]);
  }, [lead]);
  return (
    <div className="lp-show">
      <div className="lp-card lp-main">
        {lead ? (
          <>
            <div className="lp-mhead">
              <CoinIcon name={lead.name} size={36} />
              <div>
                <b>{displayName(lead.name)}-PERP</b>
                <small>Up to {lead.maxLev}x</small>
              </div>
              <LiveChg coin={lead.name} chip className="lp-chg" />
            </div>
            <div className="lp-px">
              $<LivePx coin={lead.name} />
            </div>
            <div className="lp-spark">{spark ? <Sparkline data={spark} width={420} height={130} color="#4DB5FF" fill={0.35} strokeWidth={2} full /> : <Skel w="xl" />}</div>
            <div className="lp-mfoot">
              <span>
                <small>24h volume</small>
                {fUsd(lead.vol, 0)}
              </span>
              <span>
                <small>Open interest</small>
                {fUsd(lead.oi, 0)}
              </span>
            </div>
            <div className="lp-ls">
              <Link href={tradeHref(lead.name)} className="l">
                Long
              </Link>
              <Link href={tradeHref(lead.name)} className="s">
                Short
              </Link>
            </div>
          </>
        ) : (
          <div style={{ padding: 30 }}>
            <Skel w="xl" />
          </div>
        )}
      </div>

      {tradfi.length > 0 && (
        <div className="lp-card lp-float lp-tradfi">
          <div className="lp-ftitle">
            <Icon name="layers" size={15} />
            Stocks & commodities
          </div>
          {tradfi.map((m) => (
            <Link key={m.name} href={tradeHref(m.name)} className="lp-trow">
              <CoinIcon name={m.name} size={26} />
              <b>{displayName(m.name)}</b>
              <span className="px">
                $<LivePx coin={m.name} />
              </span>
              <LiveChg coin={m.name} />
            </Link>
          ))}
        </div>
      )}

      <div className="lp-card lp-float lp-safe">
        <span className="lp-shield">
          <Icon name="shield" size={18} />
        </span>
        <div>
          <b>Your keys, your funds</b>
          <small>Trades use a session key that can&apos;t withdraw.</small>
        </div>
      </div>
    </div>
  );
}

/** One-line proof points under the hero CTAs. */
export function HeroProof() {
  const markets = useMarkets((s) => s.markets);
  const maxLev = markets.reduce((a, m) => Math.max(a, m.maxLev), 0);
  const items: [IconName, ReactNode][] = [
    ["shield", "Non-custodial"],
    ["layers", markets.length ? `${markets.length} markets` : "Crypto, stocks, gold"],
    ["bolt", maxLev ? `Up to ${maxLev}x` : "Leverage"],
  ];
  return (
    <ul className="lp-proof">
      {items.map(([ic, t]) => (
        <li key={ic}>
          <Icon name={ic} size={15} />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Logos of the markets you can trade, scrolling. */
export function MarketStrip() {
  const markets = useMarkets((s) => s.markets);
  const list: Market[] = useMemo(() => markets.slice(0, 18), [markets]);
  if (!list.length) return null;
  const row = list.map((m) => (
    <Link key={m.name} href={tradeHref(m.name)} className="lp-chip">
      <CoinIcon name={m.name} size={22} />
      {displayName(m.name)}
    </Link>
  ));
  return (
    <div className="lp-strip" aria-label="Markets you can trade">
      <div className="lp-strip-track">
        {row}
        <span aria-hidden="true" style={{ display: "contents" }}>
          {list.map((m) => (
            <span key={`d${m.name}`} className="lp-chip">
              <CoinIcon name={m.name} size={22} />
              {displayName(m.name)}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield", title: "Non-custodial by design", body: "Funds stay in your own Hyperliquid account. Orders are signed by a session key that can trade but can never withdraw." },
  { icon: "layers", title: "Crypto, stocks and gold", body: "Perps on BTC, ETH and the long tail, plus stocks, indices and commodities through Hyperliquid's HIP-3 markets." },
  { icon: "users", title: "Follow the best", body: "Every trader is ranked by recorded PnL, ROI, win rate and drawdown. Follow the ones worth following." },
  { icon: "bolt", title: "Pro terminal, simple flow", body: "Live order book, TradingView-style charts, TP/SL and one-tap closes. Deposit, enable trading, go." },
];

export function Features() {
  return (
    <section className="lp-sec">
      <div className="lp-head">
        <span className="lp-eyebrow">Why {BRAND}</span>
        <h2>Built for traders who want the edge, not the custody risk.</h2>
      </div>
      <div className="lp-feats">
        {FEATURES.map((f) => (
          <div key={f.title} className="lp-feat">
            <span className="lp-fic">
              <Icon name={f.icon} size={20} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HowItWorks() {
  const fee = (BUILDER_RATE * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  const steps = [
    { t: "Connect your wallet", b: "MetaMask, Rabby or any browser wallet. Sign one message, no gas." },
    { t: "Deposit USDC", b: `Bridge USDC from Arbitrum into your Hyperliquid account${HL.network === "testnet" ? " (testnet for now)" : ""}.` },
    { t: "Trade and get followed", b: `Open positions with TP/SL. A ${fee}% builder fee applies per order; your PnL builds your public record.` },
  ];
  return (
    <section className="lp-sec">
      <div className="lp-head">
        <span className="lp-eyebrow">How it works</span>
        <h2>From wallet to first trade in three steps.</h2>
      </div>
      <ol className="lp-steps">
        {steps.map((s, i) => (
          <li key={s.t}>
            <span className="lp-num">{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.t}</h3>
            <p>{s.b}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CtaBand({ children }: { children: ReactNode }) {
  return (
    <section className="lp-cta">
      <div className="lp-cta-mark">
        <BrandMark size={64} />
      </div>
      <h2>
        Ride the next <em>swell</em>.
      </h2>
      <p>Trade perps on Hyperliquid with a community that shows its work.</p>
      {children}
    </section>
  );
}
