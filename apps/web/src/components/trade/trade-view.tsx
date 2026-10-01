"use client";

import { change24h, displayName } from "@tideline/hl";
import { CoinIcon, Empty, fPct, fPx, fundingCountdown, fUsd, Icon, sgn } from "@tideline/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/env";
import { useNow } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { tradeHref } from "@/lib/routes";
import { openModal, useUi } from "@/lib/ui-store";
import { BookColumn, type BookPanel } from "./book";
import { BottomTabs } from "./bottom";
import { PriceChart } from "./chart";
import { useOrderForm } from "./order-store";
import { OrderPanel } from "./order-panel";
import { TradeSidebar } from "./sidebar";

function MarketHeader({ coin, panel, bookOpen, onPanel }: { coin: string; panel: BookPanel; bookOpen: boolean; onPanel(p: BookPanel): void }) {
  const m = useMarkets((s) => s.byName[coin])!;
  const px = useMarkets((s) => s.mids[coin]);
  useNow(1000);
  const c = change24h(m, px);
  useEffect(() => {
    document.title = `${fPx(px)} ${displayName(coin)} · ${BRAND}`;
  }, [px, coin]);
  return (
    <div className="thead">
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
      <div className="ptog">
        {(
          [
            ["book", "≡ Book"],
            ["trades", "↗ Trades"],
            ["depth", "▮ Depth"],
          ] as [BookPanel, string][]
        ).map(([k, label]) => (
          <button key={k} className={bookOpen && panel === k ? "on" : ""} onClick={() => onPanel(k)}>
            {label}
          </button>
        ))}
      </div>
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
  const [bookOpen, setBookOpen] = useState(false);
  const setSheet = useUi((u) => u.setSheet);
  const setForm = useOrderForm((s) => s.set);

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
        <button className="iconbtn expand" aria-label="Expand sidebar" hidden={!collapsed} onClick={() => setCollapsed(false)}>
          »
        </button>
        <div className="tmain">
          <MarketHeader
            coin={coin}
            panel={panel}
            bookOpen={bookOpen}
            onPanel={(p) => {
              if (bookOpen && panel === p) setBookOpen(false);
              else {
                setPanel(p);
                setBookOpen(true);
              }
            }}
          />
          <div className={`tbody${bookOpen ? "" : " nobook"}`}>
            <PriceChart coin={coin} displayName={displayName(coin)} />
            <BookColumn coin={coin} display={displayName(coin)} panel={panel} open={bookOpen} />
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
