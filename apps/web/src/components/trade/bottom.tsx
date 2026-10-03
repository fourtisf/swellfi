"use client";

import { displayName, type AccountPosition } from "@swellfi/hl";
import { ago, CoinIcon, Empty, fPct, fPx, fUsd, Icon, sgn, type IconName } from "@swellfi/ui";
import { useState, type ReactNode } from "react";
import { useNow } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useFills, useFundingHistory, useHlAccount, useOrderHistory } from "@/lib/trading/account";
import { errMsg, useTrading } from "@/lib/trading/use-trading";
import { toast } from "@/lib/ui-store";
import { LivePx } from "../live";
import { openTpsl, TpslModal, tpslByCoin, type TpslOrders } from "./tpsl-modal";

type Tab = "pos" | "open" | "twap" | "hist" | "fund";
const LABELS: Record<Tab, string> = { pos: "Positions", open: "Open Orders", twap: "TWAP", hist: "Order History", fund: "Funding History" };

const EMPTY: Record<Tab, [IconName, string, string]> = {
  pos: ["bolt", "No open positions", "Place an order on the right and your position shows up here."],
  open: ["trade", "No open orders", "Limit and stop orders wait here until the price reaches them."],
  twap: ["chart", "TWAP orders", "Split a large order into small slices over a set time to reduce price impact. Coming in a later release."],
  hist: ["doc", "No orders yet", "Every filled and cancelled order is listed here."],
  fund: ["chart", "No funding yet", "Open positions pay or receive funding every hour."],
};

const Asset = ({ coin }: { coin: string }) => (
  <div className="who">
    <CoinIcon name={coin} size={22} />
    <b>{displayName(coin)}</b>
  </div>
);
const SidePill = ({ long, children }: { long: boolean; children: ReactNode }) => <span className={`pill ${long ? "l" : "s"}`}>{children}</span>;
const time = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Funding on a small position is fractions of a cent per hour: show those instead of "-$0.00". */
const fFunding = (v: number) => (v !== 0 && Math.abs(v) < 0.01 ? fUsd(v, 4) : fUsd(v));

function Positions({ positions, tpsl, onClose, busy }: { positions: AccountPosition[]; tpsl: Record<string, TpslOrders>; onClose(p: AccountPosition): void; busy: string | null }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Side</th>
          <th>Size (USD)</th>
          <th>Entry</th>
          <th>Mark</th>
          <th>PnL</th>
          <th>Margin</th>
          <th>Lev.</th>
          <th>Liq. Price</th>
          <th>Funding</th>
          <th>TP / SL</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const long = p.szi > 0;
          const t = tpsl[p.coin];
          return (
            <tr key={p.coin}>
              <td>
                <Asset coin={p.coin} />
              </td>
              <td>
                <SidePill long={long}>{long ? "Long" : "Short"}</SidePill>
              </td>
              <td>
                {fUsd(p.positionValue)} <small className="dim">{Math.abs(p.szi)}</small>
              </td>
              <td>{fPx(p.entryPx)}</td>
              <td>
                <LivePx coin={p.coin} />
              </td>
              <td className={sgn(p.unrealizedPnl)}>
                <b>{fUsd(p.unrealizedPnl)}</b> <small>({fPct(p.returnOnEquity * 100, 1)})</small>
              </td>
              <td>
                {fUsd(p.marginUsed)} <small className="dim">{p.leverage.type === "cross" ? "Cross" : "Iso"}</small>
              </td>
              <td>{p.leverage.value}x</td>
              <td style={{ color: "#F5B53D" }}>{p.liquidationPx ? fPx(p.liquidationPx) : "—"}</td>
              <td className={sgn(-p.cumFundingSinceOpen)} title="Funding since open: paid (−) or received (+). Hyperliquid settles it every hour.">
                {fFunding(-p.cumFundingSinceOpen)}
              </td>
              <td>
                <button className="tpsl-btn" title="Set take profit / stop loss" onClick={() => openTpsl(p.coin)}>
                  {t?.tp || t?.sl ? (
                    <>
                      <span className={t.tp ? "up" : "mut"}>{t.tp ? fPx(t.tp) : "—"}</span> / <span className={t.sl ? "dn" : "mut"}>{t.sl ? fPx(t.sl) : "—"}</span>
                    </>
                  ) : (
                    <span className="mut">Add</span>
                  )}
                  <Icon name="pen" size={12} />
                </button>
              </td>
              <td>
                <button className="follow" disabled={busy === p.coin} onClick={() => onClose(p)}>
                  {busy === p.coin ? "Closing…" : "Close"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BottomTabs() {
  const s = useSession();
  const acct = useHlAccount();
  const trading = useTrading(acct);
  const now = useNow(30_000);
  const [tab, setTab] = useState<Tab>("pos");
  const [anaOpen, setAnaOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const live = s.status === "ready";
  const fills = useFills(live);
  const history = useOrderHistory(live && tab === "hist");
  const funding = useFundingHistory(live && tab === "fund");

  // TP/SL triggers resting against each position.
  const tpsl = tpslByCoin(acct.openOrders);

  const run = async (id: string, fn: () => Promise<unknown>, ok: (r: unknown) => string) => {
    setBusy(id);
    try {
      toast(ok(await fn()));
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const counts: Partial<Record<Tab, number>> = live ? { pos: acct.positions.length, open: acct.openOrders.length } : {};
  const upnl = acct.summary.unrealizedPnl;
  const [icon, title, desc] = EMPTY[tab];
  const empty = (
    <Empty icon={<Icon name={icon} size={20} />} title={title} style={{ padding: "26px 16px" }}>
      {desc}
    </Empty>
  );

  let body: ReactNode;
  if (!live && tab !== "twap") {
    body = (
      <Empty icon={<Icon name="wallet" size={20} />} title="Sign in to see your account" style={{ padding: "26px 16px" }}>
        Positions, orders and history show here once you connect.
      </Empty>
    );
  } else if (tab === "pos") {
    body = acct.positions.length ? (
      <Positions positions={acct.positions} tpsl={tpsl} busy={busy} onClose={(p) => run(p.coin, () => trading.closePosition(p), (m) => `Close ${displayName(p.coin)}: ${m}`)} />
    ) : (
      empty
    );
  } else if (tab === "open") {
    body = acct.openOrders.length ? (
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Type</th>
            <th>Side</th>
            <th>Price</th>
            <th>Trigger</th>
            <th>Size</th>
            <th>Placed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {acct.openOrders.map((o) => (
            <tr key={o.oid}>
              <td>
                <Asset coin={o.coin} />
              </td>
              <td>
                {o.orderType}
                {o.reduceOnly && <span className="pill n"> Reduce</span>}
              </td>
              <td>
                <SidePill long={o.side === "B"}>{o.side === "B" ? "Buy" : "Sell"}</SidePill>
              </td>
              <td>{o.orderType.includes("Market") ? "Market" : fPx(+o.limitPx)}</td>
              <td className="mut">{o.isTrigger ? `${o.triggerCondition}` : "—"}</td>
              <td>
                {o.sz} <small className="dim">{fUsd(+o.sz * +o.limitPx)}</small>
              </td>
              <td className="mut">{ago(o.timestamp, now)}</td>
              <td>
                <button className="follow" disabled={busy === `o${o.oid}`} onClick={() => run(`o${o.oid}`, () => trading.cancel(o.coin, o.oid), () => "Order cancelled")}>
                  Cancel
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      empty
    );
  } else if (tab === "hist") {
    const rows = (history.data ?? []).slice(0, 200);
    body = rows.length ? (
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Asset</th>
            <th>Type</th>
            <th>Side</th>
            <th>Price</th>
            <th>Size</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={`${h.order.oid}-${h.status}`}>
              <td className="mut">{time(h.statusTimestamp)}</td>
              <td>
                <Asset coin={h.order.coin} />
              </td>
              <td>{h.order.orderType}</td>
              <td>
                <SidePill long={h.order.side === "B"}>{h.order.side === "B" ? "Buy" : "Sell"}</SidePill>
              </td>
              <td>{fPx(+h.order.limitPx)}</td>
              <td>{h.order.origSz}</td>
              <td className={h.status === "filled" ? "up" : "mut"}>{h.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : history.isLoading ? (
      <div className="empty">Loading…</div>
    ) : (
      empty
    );
  } else if (tab === "fund") {
    const rows = funding.data ?? [];
    body = rows.length ? (
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Asset</th>
            <th>Position</th>
            <th>Rate</th>
            <th>Payment</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().slice(0, 200).map((f) => (
            <tr key={`${f.hash}-${f.delta.coin}-${f.time}`}>
              <td className="mut">{time(f.time)}</td>
              <td>
                <Asset coin={f.delta.coin} />
              </td>
              <td>{f.delta.szi}</td>
              <td className={sgn(+f.delta.fundingRate)}>{(+f.delta.fundingRate * 100).toFixed(4)}%</td>
              <td className={sgn(+f.delta.usdc)}>{fUsd(+f.delta.usdc, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : funding.isLoading ? (
      <div className="empty">Loading…</div>
    ) : (
      empty
    );
  } else {
    body = empty;
  }

  const a = fills.analytics;
  const ana: [string, ReactNode][] = live
    ? [
        ["Realized PnL", <span key="r" className={sgn(a.realized)}>{fUsd(a.realized)}</span>],
        ["Win rate", a.winRate == null ? "—" : `${a.winRate.toFixed(0)}%`],
        ["Closed trades", a.closed],
        ["Best trade", a.best ? <span key="b" className="up">{fUsd(a.best)}</span> : "—"],
        ["Volume", fUsd(a.volume)],
        ["Fees paid", fUsd(a.fees)],
      ]
    : ["Realized PnL", "Win rate", "Closed trades", "Best trade", "Volume", "Fees paid"].map((k) => [k, "—"]);

  return (
    <div className="tbottom">
      {live && <TpslModal acct={acct} trading={trading} tpsl={tpsl} />}
      <div className="btabs">
        <div className="seg">
          {(Object.keys(LABELS) as Tab[]).map((k) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {LABELS[k]}
              {counts[k] ? ` (${counts[k]})` : ""}
            </button>
          ))}
        </div>
        <button className="tool" title="Refresh" onClick={() => acct.refresh()}>
          <Icon name="gear" size={16} />
        </button>
        <span className="spacer" />
        <span className="mut">
          {live && tab === "pos" && acct.positions.length ? (
            <>
              Unrealized PnL <b className={sgn(upnl)}>{fUsd(upnl)}</b>
            </>
          ) : null}
        </span>
      </div>
      <div className="scroll-x" id="posBody">
        {body}
      </div>
      <button className={`anah${anaOpen ? "" : " closed"}`} onClick={() => setAnaOpen((o) => !o)}>
        <span className="car">▾</span>
        <Icon name="chart" size={14} /> ANALYTICS
      </button>
      {anaOpen && (
        <div className="ana">
          {ana.map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
