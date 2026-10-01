"use client";

import { change24h, displayName, type Market } from "@tideline/hl";
import { CoinIcon, fPct, fPx, fUsd, Icon, sgn, SkelRows, Sparkline } from "@tideline/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useWatchlist } from "@/lib/hooks";
import { loadSparks, useMarkets } from "@/lib/market";
import { tradeHref } from "@/lib/routes";
import { LiveChg, LivePx } from "./live";

export type MarketTab = "all" | "crypto" | "tradfi" | "fav" | "gain" | "loss";
export type SortKey = "vol" | "px" | "chg" | "oi" | "fund" | "name";

export const MARKET_TABS: [MarketTab, string][] = [
  ["all", "All"],
  ["fav", "Favorites"],
  ["crypto", "Crypto"],
  ["tradfi", "Stocks & Commodities"],
  ["gain", "Gainers"],
  ["loss", "Losers"],
];

/** Filter + sort the market universe (shared by the home table and the market selector). */
export function useMarketRows(tab: MarketTab, query: string, sort: { key: SortKey; dir: 1 | -1 }) {
  const markets = useMarkets((s) => s.markets);
  const mids = useMarkets((s) => s.mids);
  const watch = useWatchlist();
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const chg = (m: Market) => change24h(m, mids[m.name]);
    let l = markets.filter((m) => !q || displayName(m.name).toLowerCase().includes(q));
    if (tab === "crypto") l = l.filter((m) => m.kind === "crypto");
    if (tab === "tradfi") l = l.filter((m) => m.kind === "tradfi");
    if (tab === "fav") l = l.filter((m) => watch.has(m.name));
    let key = sort.key;
    let dir = sort.dir;
    if (tab === "gain") [key, dir] = ["chg", -1];
    if (tab === "loss") [key, dir] = ["chg", 1];
    const val = (m: Market): number | string =>
      key === "vol" ? m.vol : key === "px" ? (mids[m.name] ?? m.px) : key === "chg" ? chg(m) : key === "oi" ? m.oi : key === "fund" ? m.fund : displayName(m.name);
    return [...l].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir;
    });
    // mids are sampled when markets refresh or the user re-sorts; a live re-sort every tick makes rows jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets, tab, query, sort.key, sort.dir, watch.coins.join()]);
}

function Th({ k, sort, setSort, children, className }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; setSort(s: { key: SortKey; dir: 1 | -1 }): void; children: ReactNode; className?: string }) {
  const on = sort.key === k;
  return (
    <th className={`sortable${on ? " on" : ""} ${className ?? ""}`} onClick={() => setSort({ key: k, dir: on ? (sort.dir === -1 ? 1 : -1) : -1 })} aria-sort={on ? (sort.dir === -1 ? "descending" : "ascending") : "none"}>
      {children}
      <span className="arr">{on ? (sort.dir === -1 ? "↓" : "↑") : "↕"}</span>
    </th>
  );
}

function SortHead({ k, sort, setSort, children, className }: { k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; setSort(s: { key: SortKey; dir: 1 | -1 }): void; children: ReactNode; className?: string }) {
  const on = sort.key === k;
  return (
    <button className={`sortable${on ? " on" : ""} ${className ?? ""}`} onClick={() => setSort({ key: k, dir: on ? (sort.dir === -1 ? 1 : -1) : -1 })}>
      {children}
      <span className="arr">{on ? (sort.dir === -1 ? "↓" : "↑") : "↕"}</span>
    </button>
  );
}

export function Star({ coin }: { coin: string }) {
  const watch = useWatchlist();
  const on = watch.has(coin);
  return (
    <button
      className={`star${on ? " on" : ""}`}
      aria-label={on ? `Remove ${displayName(coin)} from favorites` : `Add ${displayName(coin)} to favorites`}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        watch.toggle(coin);
      }}
    >
      ★
    </button>
  );
}

const COMMODITIES = new Set(["GOLD", "SILVER", "CL", "OIL", "WTI", "BRENTOIL", "NATGAS", "COPPER", "PLATINUM", "PALLADIUM", "XAU", "XAG"]);
const INDICES = new Set(["SP500", "XYZ100", "NDX", "US500", "US100", "US30", "DJI", "RUT", "JP225", "DE40", "HK50", "SPX500", "NAS100"]);
const FX = new Set(["EUR", "JPY", "GBP", "CNH", "DXY", "AUD", "CAD", "CHF"]);

export function marketCategory(m: Pick<Market, "name" | "kind">) {
  if (m.kind === "crypto") return "Crypto";
  const s = displayName(m.name);
  return COMMODITIES.has(s) ? "Commodity" : INDICES.has(s) ? "Index" : FX.has(s) ? "Forex" : "Stock";
}

export function MarketName({ m, size = 32 }: { m: Market; size?: number }) {
  return (
    <div className="who">
      <CoinIcon name={m.name} size={size} />
      <div>
        <span className="n">
          {displayName(m.name)}
          <span className="lv-tag">{m.maxLev}x</span>
        </span>
        <small>{marketCategory(m)} · Perp</small>
      </div>
    </div>
  );
}

/** Full markets table: search, category tabs, sortable columns, favorites, sparklines. */
export function MarketsTable({ limit = 15 }: { limit?: number }) {
  const [tab, setTab] = useState<MarketTab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "vol", dir: -1 });
  const [all, setAll] = useState(false);
  const rows = useMarketRows(tab, q, sort);
  const status = useMarkets((s) => s.status);
  const spark = useMarkets((s) => s.spark);
  const router = useRouter();
  const shown = all ? rows : rows.slice(0, limit);
  const names = shown.map((m) => m.name).join(",");
  useEffect(() => {
    if (names) void loadSparks(names.split(","));
  }, [names]);

  return (
    <div className="mkt-panel glass">
      <div className="mkt-bar">
        <div className="mkt-tabs" role="tablist">
          {MARKET_TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {k === "fav" && <span style={{ color: "#F5B53D" }}>★ </span>}
              {label}
            </button>
          ))}
        </div>
        <div className="sbox mkt-search">
          <Icon name="search" size={16} />
          <input className="input" placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="scroll-x">
        <table className="mkt-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <Th k="name" sort={sort} setSort={setSort}>
                Market
              </Th>
              <Th k="px" sort={sort} setSort={setSort}>
                Price
              </Th>
              <Th k="chg" sort={sort} setSort={setSort}>
                24h
              </Th>
              <th className="hide-m">Last 24h</th>
              <Th k="vol" sort={sort} setSort={setSort} className="hide-m">
                Volume
              </Th>
              <Th k="oi" sort={sort} setSort={setSort} className="hide-m hide-md">
                Open interest
              </Th>
              <Th k="fund" sort={sort} setSort={setSort} className="hide-m hide-md">
                Funding 1h
              </Th>
              <th className="hide-m" />
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.name} className="click" onClick={() => router.push(tradeHref(m.name))}>
                <td style={{ paddingRight: 0 }}>
                  <Star coin={m.name} />
                </td>
                <td>
                  <MarketName m={m} />
                </td>
                <td style={{ fontWeight: 600 }}>
                  <LivePx coin={m.name} />
                </td>
                <td>
                  <LiveChg coin={m.name} chip />
                </td>
                <td className="hide-m">{spark[m.name] ? <Sparkline data={spark[m.name]} width={120} height={34} fill={0.22} /> : <span className="sk w-lg" />}</td>
                <td className="hide-m">{fUsd(m.vol)}</td>
                <td className="hide-m hide-md">{fUsd(m.oi)}</td>
                <td className={`hide-m hide-md ${sgn(m.fund)}`}>{m.fund.toFixed(4)}%</td>
                <td className="hide-m">
                  <span className="btn btn-ghost trade-cta">Trade</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length &&
          (status === "loading" ? (
            <SkelRows n={8} />
          ) : (
            <div className="empty">
              {status === "error" ? "Couldn't reach Hyperliquid. Retrying…" : tab === "fav" ? "Star markets to see them here." : "No markets match your search."}
            </div>
          ))}
      </div>
      {rows.length > limit && (
        <button className="mkt-more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length} markets`} <Icon name="chevron" size={14} style={all ? { transform: "rotate(180deg)" } : undefined} />
        </button>
      )}
    </div>
  );
}

/** Three spotlight cards above the table: biggest gainer, most traded, biggest mover in stocks. */
export function MarketHighlights() {
  const markets = useMarkets((s) => s.markets);
  const spark = useMarkets((s) => s.spark);
  const router = useRouter();
  const picks = useMemo(() => {
    const mids = useMarkets.getState().mids;
    const vol = markets[0];
    const gain = markets
      .filter((m) => m.kind === "crypto" && m.vol > 1e6 && m !== vol)
      .sort((a, b) => change24h(b, mids[b.name]) - change24h(a, mids[a.name]))[0];
    const stock = markets
      .filter((m) => m.kind === "tradfi" && m !== vol)
      .sort((a, b) => Math.abs(change24h(b, mids[b.name])) - Math.abs(change24h(a, mids[a.name])))[0];
    return [
      ["Most traded", vol],
      ["Top crypto gainer", gain],
      ["Stocks & commodities mover", stock],
    ].filter(([, m]) => m) as [string, Market][];
  }, [markets]);
  const names = picks.map(([, m]) => m.name).join(",");
  useEffect(() => {
    if (names) void loadSparks(names.split(","));
  }, [names]);
  if (!picks.length) return null;
  return (
    <div className="hl-cards">
      {picks.map(([label, m]) => (
        <button key={label} className="hl-card glass" onClick={() => router.push(tradeHref(m.name))}>
          <div className="hl-top">
            <span className="hl-label">{label}</span>
            <LiveChg coin={m.name} chip />
          </div>
          <div className="hl-mid">
            <CoinIcon name={m.name} size={40} />
            <div>
              <b>{displayName(m.name)}</b>
              <span className="hl-px">
                $<LivePx coin={m.name} />
              </span>
            </div>
          </div>
          <div className="hl-spark">{spark[m.name] && <Sparkline data={spark[m.name]} width={300} height={56} full fill={0.28} />}</div>
          <div className="hl-foot">
            <span>Vol {fUsd(m.vol)}</span>
            <span>OI {fUsd(m.oi)}</span>
            <span>Up to {m.maxLev}x</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Compact sortable list for the market selector (terminal). */
export function MarketSelector({ current, onPick }: { current?: string; onPick(coin: string): void }) {
  const [tab, setTab] = useState<MarketTab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "vol", dir: -1 });
  const rows = useMarketRows(tab, q, sort).slice(0, 200);
  const mids = useMarkets((s) => s.mids);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [q, tab]);
  return (
    <div className="msel">
      <div className="sbox">
        <Icon name="search" size={16} />
        <input
          className="input"
          placeholder="Search markets"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(rows.length - 1, s + 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
            if (e.key === "Enter" && rows[sel]) onPick(rows[sel].name);
          }}
        />
      </div>
      <div className="mkt-tabs sm">
        {MARKET_TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {k === "fav" && <span style={{ color: "#F5B53D" }}>★ </span>}
            {label}
          </button>
        ))}
      </div>
      <div className="msel-head">
        <span />
        <SortHead k="name" sort={sort} setSort={setSort}>
          Market
        </SortHead>
        <SortHead k="px" sort={sort} setSort={setSort}>
          Price
        </SortHead>
        <SortHead k="chg" sort={sort} setSort={setSort}>
          24h
        </SortHead>
        <SortHead k="vol" sort={sort} setSort={setSort} className="hide-m">
          Volume
        </SortHead>
        <SortHead k="fund" sort={sort} setSort={setSort} className="hide-m">
          Funding
        </SortHead>
      </div>
      <div className="list msel-list">
        {rows.map((m, i) => {
          const c = change24h(m, mids[m.name]);
          return (
            <div key={m.name} className={`msel-row${i === sel ? " sel" : ""}${m.name === current ? " cur" : ""}`} onMouseEnter={() => setSel(i)}>
              <Star coin={m.name} />
              <button className="pk" onClick={() => onPick(m.name)}>
                <span className="msel-name">
                  <CoinIcon name={m.name} size={26} />
                  <b>{displayName(m.name)}</b>
                  <span className="lv-tag">{m.maxLev}x</span>
                </span>
                <span>{fPx(mids[m.name])}</span>
                <span className={sgn(c)}>{fPct(c)}</span>
                <span className="hide-m mut">{fUsd(m.vol)}</span>
                <span className={`hide-m ${sgn(m.fund)}`}>{m.fund.toFixed(4)}%</span>
              </button>
            </div>
          );
        })}
        {!rows.length && <div className="empty">{tab === "fav" ? "Star markets to see them here." : "No markets match."}</div>}
      </div>
    </div>
  );
}
