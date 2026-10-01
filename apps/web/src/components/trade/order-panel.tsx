"use client";

import { estimateOrder, HL_FEES, type Market } from "@tideline/hl";
import { fPx, fUsd, pxInput } from "@tideline/ui";
import { useEffect, useState, type CSSProperties } from "react";
import { BUILDER_RATE } from "@/lib/env";
import { useMarkets } from "@/lib/market";
import { useSession } from "@/lib/session";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { useOrderForm } from "./order-store";

const rangePct = (v: number, min: number, max: number) => ({ "--p": `${((v - min) / (max - min || 1)) * 100}%` }) as CSSProperties;
const pct = (r: number) => `${Number((r * 100).toFixed(3))}%`;

function LeveragePopover({ max, onClose }: { max: number; onClose(): void }) {
  const { lev, set } = useOrderForm();
  const [v, setV] = useState(lev);
  const marks = [1, Math.round(max * 0.25), Math.round(max * 0.5), Math.round(max * 0.75), max].filter((x, i, a) => x >= 1 && a.indexOf(x) === i);
  return (
    <div className="levpop" id="levPop">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <b>Adjust leverage</b>
        <b style={{ color: "var(--brand)" }}>{v}x</b>
      </div>
      <input type="range" className="range" min={1} max={max} value={v} aria-label="Leverage" style={rangePct(v, 1, max)} onChange={(e) => setV(+e.target.value)} />
      <div className="ticks">
        {marks.map((m) => (
          <button key={m} onClick={() => setV(m)}>
            {m}x
          </button>
        ))}
      </div>
      <p className="dim" style={{ fontSize: 12, margin: "10px 0" }}>
        Higher leverage moves your liquidation price closer to entry.
      </p>
      <button
        className="btn btn-brand"
        style={{ width: "100%", height: 38 }}
        onClick={() => {
          set({ lev: v });
          onClose();
          toast(`Leverage set to ${v}x`);
        }}
      >
        Confirm
      </button>
    </div>
  );
}

function AccountCard() {
  const s = useSession();
  const ready = s.status === "ready";
  const rows: [string, string][] = [
    ["Available Balance", "—"],
    ["Total Equity", "—"],
    ["Unrealized PnL", "—"],
    ["Margin Used", "—"],
    ["Account Leverage", "—"],
  ];
  return (
    <div className="tacc" id="accCard">
      <div className="h">
        <b>Trading Account</b>
        <span className="live" style={{ color: ready ? "#F5B53D" : "var(--dim)" }}>
          ● {ready ? "NOT ENABLED" : "OFFLINE"}
        </span>
      </div>
      {rows.map(([k, v]) => (
        <div className="r" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      {ready && (
        <div className="acts">
          <button className="btn btn-ghost" style={{ height: 38 }} onClick={() => toast("Deposits open with trading: USDC from Arbitrum into Hyperliquid")}>
            Deposit
          </button>
          <button className="btn btn-ghost" style={{ height: 38 }} onClick={() => toast("Withdrawals open with trading and are signed by your own wallet")}>
            Withdraw
          </button>
        </div>
      )}
    </div>
  );
}

export function OrderPanel({ market }: { market: Market }) {
  const f = useOrderForm();
  const s = useSession();
  const mid = useMarkets((st) => st.mids[market.name]) ?? market.px;
  const sheetOpen = useUi((u) => u.sheetOpen);
  const setSheet = useUi((u) => u.setSheet);
  const [levOpen, setLevOpen] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [pctV, setPctV] = useState(0);

  // Clamp leverage to the market's max and reset per-market inputs.
  useEffect(() => {
    const st = useOrderForm.getState();
    st.set({ lev: Math.min(st.lev, market.maxLev), px: "", size: "", tp: "", sl: "", reduceOnly: false });
    setPctV(0);
  }, [market.name, market.maxLev]);

  // Prefill the price box with mid when switching to limit/stop.
  useEffect(() => {
    if (f.otype !== "market" && !f.px && mid) f.set({ px: pxInput(mid) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.otype, market.name, mid > 0]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest("#levPop,#levBtn")) setLevOpen(false);
      if (!t.closest("#proMenu,#proBtn")) setProOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const px = f.otype === "market" ? mid : parseFloat(f.px) || mid;
  const v = parseFloat(f.size) || 0;
  const margin = f.unit === "margin" ? v : v / f.lev;
  const est = estimateOrder({ side: f.side, type: f.otype, px, margin, leverage: f.lev, maxLeverage: market.maxLev, builderRate: BUILDER_RATE });
  const baseFee = f.otype === "limit" ? HL_FEES.maker : HL_FEES.taker;

  let btnText: string;
  let btnDisabled = false;
  let onSubmit: () => void = () => {};
  if (s.status === "anon" || s.status === "loading") {
    btnText = "Sign in to trade";
    onSubmit = () => openModal("wallet");
  } else if (s.status === "needsInvite") {
    btnText = "Enter invite code";
    onSubmit = () => openModal("invite");
  } else {
    btnText = !margin ? "Enter a size" : `${f.side === "long" ? "Buy / Long" : "Sell / Short"} ${market.name.includes(":") ? market.name.split(":")[1] : market.name}`;
    btnDisabled = true; // Order placement ships with Phase 2 (testnet first).
  }

  return (
    <aside className={`tord${sheetOpen ? " open" : ""}`} id="tord">
      <div className="sheet-h" onClick={() => setSheet(false)}>
        <span />
      </div>
      <div className="ord-top">
        <button
          onClick={() => {
            const next = f.margin === "cross" ? "isolated" : "cross";
            if (next === "cross" && market.onlyIsolated) return toast(`${market.name} trades isolated only`);
            f.set({ margin: next });
            toast(next === "cross" ? "Cross margin: all positions share your balance" : "Isolated margin: risk is limited to this position");
          }}
        >
          Margin: <b>{f.margin === "cross" && !market.onlyIsolated ? "Cross" : "Isolated"}</b> <span className="dim">▾</span>
        </button>
        <button id="levBtn" onClick={() => (setLevOpen((o) => !o), setProOpen(false))}>
          Leverage: <b>{f.lev}x</b> <span className="dim">▾</span>
        </button>
      </div>
      {levOpen && <LeveragePopover max={market.maxLev} onClose={() => setLevOpen(false)} />}
      <div className="otabs">
        <button className={f.otype === "market" ? "on" : ""} onClick={() => f.set({ otype: "market" })}>
          Market
        </button>
        <button className={f.otype === "limit" ? "on" : ""} onClick={() => f.set({ otype: "limit" })}>
          Limit
        </button>
        <button id="proBtn" className={f.otype === "stop" ? "on" : ""} onClick={() => (setProOpen((o) => !o), setLevOpen(false))}>
          {f.otype === "stop" ? "Stop ▾" : "Pro ▾"}
        </button>
      </div>
      {proOpen && (
        <div className="promenu" id="proMenu">
          <button onClick={() => (setProOpen(false), f.set({ otype: "stop" }))}>Stop Market</button>
          {["Stop Limit", "Scale", "TWAP"].map((t) => (
            <button key={t} onClick={() => (setProOpen(false), toast(`${t} orders ship in a later release`))}>
              {t} <small>Soon</small>
            </button>
          ))}
        </div>
      )}
      <div className="sides2">
        <button data-side="long" className={f.side === "long" ? "on" : ""} onClick={() => f.set({ side: "long" })}>
          Buy / Long
        </button>
        <button data-side="short" className={f.side === "short" ? "on" : ""} onClick={() => f.set({ side: "short" })}>
          Sell / Short
        </button>
      </div>
      <div className="frow" hidden={f.otype === "market"}>
        <label>
          {f.otype === "stop" ? "Trigger" : "Price"} <span className="dim">(USDC)</span>
        </label>
        <input inputMode="decimal" placeholder="0.00" value={f.px} onChange={(e) => f.set({ px: e.target.value.replace(/[^0-9.]/g, "") })} />
        <button className="mini" onClick={() => f.set({ px: pxInput(mid) })}>
          Mid
        </button>
      </div>
      <div className="frow">
        <label>Size</label>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={f.size}
          onChange={(e) => {
            f.set({ size: e.target.value.replace(/[^0-9.]/g, "") });
            setPctV(0);
          }}
        />
        <button
          className="mini"
          onClick={() => {
            const val = parseFloat(f.size) || 0;
            if (f.unit === "margin") f.set({ unit: "usd", size: val ? (val * f.lev).toFixed(2) : f.size });
            else f.set({ unit: "margin", size: val ? (val / f.lev).toFixed(2) : f.size });
          }}
        >
          {f.unit === "margin" ? "Margin" : "USD"} ▾
        </button>
      </div>
      <div className="pct">
        <div className="ptrack">
          {[0, 25, 50, 75, 100].map((p) => (
            <i key={p} style={{ left: `${p}%` }} />
          ))}
        </div>
        <input
          type="range"
          className="range"
          min={0}
          max={100}
          value={pctV}
          aria-label="Size percent"
          style={rangePct(pctV, 0, 100)}
          onChange={(e) => {
            if (s.status !== "ready") {
              setPctV(0);
              return openModal(s.status === "needsInvite" ? "invite" : "wallet");
            }
            setPctV(+e.target.value);
            toast("Sizing by balance works once trading is enabled");
          }}
        />
        <div className="pdots">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
      <div className="opts">
        <button onClick={() => f.set({ showTpSl: !f.showTpSl, tp: "", sl: "" })}>{f.showTpSl ? "− Remove TP/SL" : "+ Add TP/SL"}</button>
        <label className="ro">
          Reduce Only{" "}
          <span
            className={`sw${f.reduceOnly ? " on" : ""}`}
            role="switch"
            aria-checked={f.reduceOnly}
            tabIndex={0}
            onClick={() => f.set({ reduceOnly: !f.reduceOnly })}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                f.set({ reduceOnly: !f.reduceOnly });
              }
            }}
          />
        </label>
      </div>
      {f.showTpSl && (
        <div className="tp-grid">
          <input className="input" placeholder="Take profit price" inputMode="decimal" value={f.tp} onChange={(e) => f.set({ tp: e.target.value.replace(/[^0-9.]/g, "") })} />
          <input className="input" placeholder="Stop loss price" inputMode="decimal" value={f.sl} onChange={(e) => f.set({ sl: e.target.value.replace(/[^0-9.]/g, "") })} />
        </div>
      )}
      <div className="osum">
        <div>
          <span>Order value</span>
          <span>{est.notional ? fUsd(est.notional) : "—"}</span>
        </div>
        <div>
          <span>Margin required</span>
          <span>{est.margin ? fUsd(est.margin) : "—"}</span>
        </div>
        <div>
          <span>Est. liquidation</span>
          <span>{est.notional ? fPx(est.liqPx) : "—"}</span>
        </div>
        <div>
          <span>Fees</span>
          <span title={`Hyperliquid ${pct(baseFee)} + ${pct(BUILDER_RATE)} platform fee`}>{est.notional ? fUsd(est.fee) : `${pct(baseFee)} + ${pct(BUILDER_RATE)}`}</span>
        </div>
      </div>
      <button className={`bigbtn${s.status === "ready" && f.side === "short" ? " s" : ""}`} disabled={btnDisabled} onClick={onSubmit}>
        {btnText}
      </button>
      {s.status === "ready" && <p className="note">Order placement switches on in the next release, on Hyperliquid testnet first.</p>}
      <AccountCard />
    </aside>
  );
}
