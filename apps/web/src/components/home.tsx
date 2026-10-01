"use client";

import { useQuery } from "@tanstack/react-query";
import { change24h, displayName, type Market } from "@swellfi/hl";
import { CoinIcon, Empty, fPct, fUsd, Icon, sgn, Skel, SkelRows, Sparkline } from "@swellfi/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ActivityItem, type LeaderRow } from "@/lib/api";
import { BRAND, HL } from "@/lib/env";
import { useNow } from "@/lib/hooks";
import { loadSparks, useMarkets } from "@/lib/market";
import { traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { useHlAccount } from "@/lib/trading/account";
import { openModal } from "@/lib/ui-store";
import { LiveChg, LivePx } from "./live";
import { MarketHighlights, MarketsTable } from "./markets";
import { ActivityRow, TraderCell } from "./social";

type HomeKey = "vol" | "gain" | "loss" | "tradfi";

function useHomeList(k: HomeKey) {
  const markets = useMarkets((s) => s.markets);
  const mids = useMarkets((s) => s.mids);
  return useMemo(() => {
    let l: Market[] = [...markets];
    const chg = (m: Market) => change24h(m, mids[m.name]);
    if (k === "gain") l.sort((a, b) => chg(b) - chg(a));
    else if (k === "loss") l.sort((a, b) => chg(a) - chg(b));
    else if (k === "tradfi") l = l.filter((m) => m.kind === "tradfi");
    return l;
    // Re-sort gainers/losers on market refresh, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, k]);
}

function HeroCtas() {
  const s = useSession();
  if (s.status === "ready") {
    return (
      <div className="ctas">
        <Link className="btn btn-brand" href="/trade">
          Start trading <Icon name="arrow" size={16} />
        </Link>
        <Link className="btn btn-ghost" href="/rankings">
          See top traders
        </Link>
      </div>
    );
  }
  if (s.status === "needsInvite") {
    return (
      <div className="ctas">
        <button className="btn btn-brand" onClick={() => openModal("invite")}>
          Enter invite code <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
        </button>
        <Link className="btn btn-ghost" href="/rankings">
          See top traders
        </Link>
      </div>
    );
  }
  return (
    <div className="ctas">
      <button className="btn btn-brand" onClick={() => openModal("waitlist")}>
        Join waitlist <span style={{ fontSize: 18, lineHeight: 1 }}>→</span>
      </button>
      <button className="btn btn-ghost" onClick={() => openModal("wallet")}>
        Log in
      </button>
    </div>
  );
}

// Until the platform has a meaningful user base, the hero shows live Hyperliquid market stats
// instead of near-zero platform counters.
const PLATFORM_STATS_MIN_USERS = 1000;

function PlatformStats() {
  const q = useQuery({ queryKey: ["stats"], queryFn: () => api<{ users: number; tvl: string; volume: string; trades: number }>("/stats"), refetchInterval: 30_000 });
  const markets = useMarkets((s) => s.markets);
  const d = q.data;
  if (d && d.users >= PLATFORM_STATS_MIN_USERS) {
    return (
      <div className="pstats" id="stats">
        <div>
          <b>{d.users.toLocaleString()}</b>
          <span>Global users</span>
        </div>
        <div className="hl">
          <b>{fUsd(+d.tvl, 0)}</b>
          <span>Platform TVL</span>
        </div>
        <div>
          <b>{fUsd(+d.volume, 0)}</b>
          <span>Trading volume</span>
        </div>
        <div>
          <b>{d.trades.toLocaleString()}</b>
          <span>Trades placed</span>
        </div>
      </div>
    );
  }
  const ready = markets.length > 0;
  const vol = markets.reduce((a, m) => a + m.vol, 0);
  const oi = markets.reduce((a, m) => a + m.oi, 0);
  const maxLev = markets.reduce((a, m) => Math.max(a, m.maxLev), 0);
  return (
    <div className="pstats" id="stats">
      <div>
        <b>{ready ? markets.length.toLocaleString() : <Skel />}</b>
        <span>Markets</span>
      </div>
      <div className="hl">
        <b>{ready ? fUsd(vol, 0) : <Skel w="lg" />}</b>
        <span>24h volume</span>
      </div>
      <div>
        <b>{ready ? fUsd(oi, 0) : <Skel w="lg" />}</b>
        <span>Open interest</span>
      </div>
      <div>
        <b>{ready ? `${maxLev}x` : <Skel />}</b>
        <span>Max leverage</span>
      </div>
    </div>
  );
}

function LiveActivity() {
  const now = useNow(20_000);
  const acts = useQuery({ queryKey: ["activity", "home"], queryFn: () => api<{ items: ActivityItem[] }>("/activity?limit=7"), refetchInterval: 10_000 });
  const sum = useQuery({
    queryKey: ["activity", "summary"],
    queryFn: () => api<{ volumeToday: string; topCoin: string | null; tradersToday: number }>("/activity/summary"),
    refetchInterval: 30_000,
  });
  const firstId = useRef<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const items = acts.data?.items ?? [];
  const headId = items[0]?.id ?? null;
  useEffect(() => {
    if (firstId.current && headId && headId !== firstId.current) setFreshId(headId);
    firstId.current = headId;
  }, [headId]);
  const top = sum.data?.topCoin ?? "BTC";
  return (
    <div className="actcard glass">
      <div className="act-top">
        <span className="lv">
          <span className="dot live" />
          Live on {BRAND}
        </span>
        <Link href="/feed" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontWeight: 500 }}>
          View activity <Icon name="arrow" size={14} />
        </Link>
      </div>
      <div className="act-sum">
        <span>
          <b>{fUsd(+(sum.data?.volumeToday ?? 0), 0)}</b> traded today
        </span>
        <i />
        <span className="cp">
          <CoinIcon name={top} size={20} />
          {displayName(top)}
        </span>
        <span>most traded</span>
        <i />
        <span>
          <b>{sum.data?.tradersToday ?? 0}</b> traders
        </span>
      </div>
      <div>
        {items.length ? (
          items.map((a) => <ActivityRow key={a.id} a={a} now={now} fresh={a.id === freshId} />)
        ) : (
          acts.isLoading ? <SkelRows n={5} /> : <div className="empty">No activity yet. Trades show up here as they happen.</div>
        )}
      </div>
    </div>
  );
}

function Portfolio() {
  const s = useSession();
  if (s.status !== "ready") {
    return (
      <Empty icon={<Icon name="wallet" size={22} />} title={s.status === "needsInvite" ? "Finish signing up to see your portfolio" : "Connect a wallet to see your portfolio"}>
        Balance, open positions and PnL show up here.
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-brand" onClick={() => openModal(s.status === "needsInvite" ? "invite" : "wallet")}>
            {s.status === "needsInvite" ? "Enter invite code" : "Connect wallet"}
          </button>
        </div>
      </Empty>
    );
  }
  return <LivePortfolio />;
}

function LivePortfolio() {
  const acct = useHlAccount();
  const router = useRouter();
  const sm = acct.summary;
  return (
    <>
      <div className="kv" style={{ margin: "16px 18px" }}>
        <div>
          <small>Available</small>
          <b>{acct.loaded ? fUsd(sm.withdrawable) : <Skel />}</b>
        </div>
        <div>
          <small>Unrealized PnL</small>
          <b className={sgn(sm.unrealizedPnl)}>{acct.loaded ? fUsd(sm.unrealizedPnl) : <Skel />}</b>
        </div>
        <div>
          <small>Open positions</small>
          <b>{acct.positions.length}</b>
        </div>
      </div>
      {acct.positions.length ? (
        <table>
          <tbody>
            {acct.positions.map((p) => (
              <tr key={p.coin} className="click" onClick={() => router.push(tradeHref(p.coin))}>
                <td>
                  <div className="who">
                    <CoinIcon name={p.coin} size={26} />
                    <span className="n">{displayName(p.coin)}</span>
                    <span className={`pill ${p.szi > 0 ? "l" : "s"}`}>
                      {p.szi > 0 ? "Long" : "Short"} {p.leverage.value}x
                    </span>
                  </div>
                </td>
                <td>{fUsd(p.positionValue)}</td>
                <td className={sgn(p.unrealizedPnl)}>
                  <b>{fUsd(p.unrealizedPnl)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty" style={{ paddingTop: 10 }}>
          {acct.funded ? "No open positions yet." : (
            <>
              Deposit USDC to start trading.
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-brand" onClick={() => openModal("deposit")}>
                  Deposit
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function TopTraders() {
  const q = useQuery({ queryKey: ["leaderboard", "7d", 5], queryFn: () => api<{ rows: LeaderRow[] }>("/leaderboard?tf=7d&limit=5") });
  const router = useRouter();
  if (q.isLoading) return <SkelRows n={5} />;
  return (
    <table>
      <tbody>
        {(q.data?.rows ?? []).map((t, i) => (
          <tr key={t.user.id} className="click" onClick={() => router.push(traderHref(t.user.handle))}>
            <td>
              <div className="who">
                <span className="rank" style={i < 3 ? { color: "var(--brand)" } : undefined}>
                  {i + 1}
                </span>
                <TraderCell user={t.user} />
              </div>
            </td>
            <td className="hide-m">
              <Sparkline data={t.series} width={90} height={30} fill={0.2} />
            </td>
            <td>
              <b className={sgn(+t.pnl)}>{fUsd(+t.pnl, 0)}</b>
              <small className="dim" style={{ display: "block" }}>
                {fPct(t.roi, 1)}
              </small>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HomeView() {
  return (
    <section className="view on" id="v-home">
      <div className="hero2 glass glow-border">
        <span className="hero-chip">
          <span className="dot live" />
          Live on Hyperliquid{HL.network === "testnet" ? " · Testnet" : ""}
        </span>
        <h1>
          Every trade makes <em>waves</em>.
        </h1>
        <p>Trade crypto, stocks and commodities with leverage. Follow the traders worth following and build a track record of your own.</p>
        <HeroCtas />
        <PlatformStats />
      </div>
      <LiveActivity />
      <div className="wrap-1040">
        <div className="sec-title">
          <div>
            <h2>Markets</h2>
            <p>Prices stream straight from Hyperliquid. Tap any market to trade it.</p>
          </div>
          <Link className="btn btn-ghost" href="/markets" style={{ height: 38 }}>
            All markets <Icon name="arrow" size={14} />
          </Link>
        </div>
        <MarketHighlights />
        <MarketsTable limit={12} />
        <div className="duo" style={{ marginTop: 18 }}>
          <div className="glass">
            <div className="ph">
              <h3>Portfolio</h3>
              <span className="mut" />
            </div>
            <Portfolio />
          </div>
          <div className="glass">
            <div className="ph">
              <h3>Top traders this week</h3>
              <Link className="mut" href="/rankings">
                View all
              </Link>
            </div>
            <TopTraders />
          </div>
        </div>
      </div>
    </section>
  );
}
