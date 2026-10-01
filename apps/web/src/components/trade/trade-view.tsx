"use client";

import { change24h, displayName } from "@swellfi/hl";
import { CoinIcon, Empty, fPct, fPx, fundingCountdown, fUsd, Icon, sgn } from "@swellfi/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/env";
import { useNow } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { tradeHref } from "@/lib/routes";
import { openModal, useUi } from "@/lib/ui-store";
import { BookColumn, type BookPanel } from "./book";
import { BottomTabs } from "./bottom";
import { PriceChart, type ChartLine } from "./chart";
import { useHlAccount } from "@/lib/trading/account";
import { useOrderForm } from "./order-store";
import { OrderPanel } from "./order-panel";
import { TradeSidebar } from "./sidebar";

function MarketHeader({ coin, bookOpen, onToggleBook, collapsed, onExpand }: { coin: string; bookOpen: boolean; onToggleBook(): void; collapsed: boolean; onExpand(): void }) {
  const m = useMarkets((s) => s.byName[coin])!;
  const px = useMarkets((s) => s.mids[coin]);
  useNow(1000);
  const c = change24h(m, px);
  useEffect(() => {
    document.title = `${fPx(px)} ${displayName(coin)} · ${BRAND}`;
  }, [px, coin]);
  return (
    <div className="thead">
      {collapsed && (
        <button className="iconbtn expand" aria-label="Show watchlist and chat" title="Show watchlist and chat" onClick={onExpand}>
          »
        </button>
      )}
      <button className="cpick" aria-label="Change market" onClick={() => openModal("picker")}>
        <CoinIcon name={coin} size={28} />
        <b>{displayName(coin)}</b>
        <span className="lev">{m.maxLev}x</span>
        <span className="dim">▾</span>
      </button>
      <div className="hs">
        <small>Mark Price</small>
        <span id="hPx">${fPx(px)}</span>
      </div>
      <div className="hs">
        <small>24h Change</small>
        <span className={sgn(c)}>{fPct(c)}</span>
      </div>
      <div className="hs hide-m hide-lg">
        <small>24h Volume</small>
        <span>{fUsd(m.vol)}</span>
      </div>
      <div className="hs hide-m hide-md">
        <small>Open Interest</small>
        <span>{fUsd(m.oi)}</span>
      </div>
      <div className="hs hide-m">
        <small>Funding / Countdown</small>
        <span>
          <span className={sgn(m.fund)}>{m.fund.toFixed(4)}%</span> <span className="dim">{fundingCountdown()}</span>
        </span>
      </div>
      <div className="spacer" />
      <button className={`booktog${bookOpen ? " on" : ""}`} aria-pressed={bookOpen} onClick={onToggleBook} title={bookOpen ? "Hide order book" : "Show order book"}>
        ≡ <span>Order book</span>
      </button>
    </div>
  );
}

export function TradeView({ coin }: { coin: string }) {
  const market = useMarkets((s) => s.byName[coin]);
  const status = useMarkets((s) => s.status);
  const loaded = useMarkets((s) => s.markets.length > 0);
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<BookPanel>("book");
  const [bookOpen, setBookOpen] = useState(true);

  // Give the chart room on laptop screens: the watchlist/chat sidebar starts collapsed below 1600px.
  useEffect(() => {
    if (window.innerWidth < 1600) setCollapsed(true);
  }, []);
  const setSheet = useUi((u) => u.setSheet);
  const setForm = useOrderForm((s) => s.set);
  const acct = useHlAccount();
  const pos = acct.positions.find((p) => p.coin === coin);
  const lines: ChartLine[] = pos
    ? [
        { price: pos.entryPx, color: "#4DB5FF", title: `Your ${pos.szi > 0 ? "long" : "short"} · ${pos.leverage.value}x` },
        ...(pos.liquidationPx ? [{ price: pos.liquidationPx, color: "#F5B53D", title: "Liq." }] : []),
      ]
    : [];

  useEffect(() => {
    document.body.classList.add("is-trade");
    return () => {
      document.body.classList.remove("is-trade");
      document.title = BRAND;
    };
  }, []);

  if (!market) {
    return (
      <section className="view on" id="v-trade">
        <div style={{ padding: "60px 18px" }}>
          {loaded ? (
            <Empty icon={<Icon name="search" size={22} />} title={`${displayName(coin)} isn't listed`}>
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-brand" onClick={() => router.push(tradeHref("BTC"))}>
                  Trade BTC instead
                </button>
              </div>
            </Empty>
          ) : (
            <div className="empty">{status === "error" ? "Couldn't reach Hyperliquid. Retrying…" : "Loading market…"}</div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="view on" id="v-trade">
      <div className={`term${collapsed ? " collapsed" : ""}`} id="term">
        <TradeSidebar coin={coin} onCollapse={() => setCollapsed(true)} />
        <div className="tmain">
          <MarketHeader coin={coin} bookOpen={bookOpen} onToggleBook={() => setBookOpen((o) => !o)} collapsed={collapsed} onExpand={() => setCollapsed(false)} />
          <div className={`tbody${bookOpen ? "" : " nobook"}`}>
            <PriceChart coin={coin} displayName={displayName(coin)} lines={lines} />
            <BookColumn coin={coin} display={displayName(coin)} panel={panel} onPanel={setPanel} open={bookOpen} />
          </div>
          <BottomTabs />
        </div>
        <OrderPanel market={market} />
      </div>
      <div className="mtrade" id="mtrade">
        <button data-ms="long" onClick={() => (setForm({ side: "long" }), setSheet(true))}>
          Buy / Long
        </button>
        <button data-ms="short" onClick={() => (setForm({ side: "short" }), setSheet(true))}>
          Sell / Short
        </button>
      </div>
    </section>
  );
}
