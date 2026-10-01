"use client";

import { displayName, estimateOrder, HL_FEES, MIN_ORDER_USD, type Market } from "@tideline/hl";
import { fPx, fUsd, pxInput, sgn, Skel } from "@tideline/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BUILDER_RATE, HL } from "@/lib/env";
import { useMarkets } from "@/lib/market";
import { useSession } from "@/lib/session";
import { TRADING_NETWORK_OK, useHlAccount, type HlAccount } from "@/lib/trading/account";
import { errMsg, useTrading } from "@/lib/trading/use-trading";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { useOrderForm } from "./order-store";

const rangePct = (v: number, min: number, max: number) => ({ "--p": `${((v - min) / (max - min || 1)) * 100}%` }) as CSSProperties;
const pct = (r: number) => `${Number((r * 100).toFixed(3))}%`;
const num = (s: string) => s.replace(/[^0-9.]/g, "");
const UNITS = ["margin", "usd", "coin"] as const;

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
        Higher leverage moves your liquidation price closer to entry. Applied on Hyperliquid with your next order.
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

function AccountCard({ acct }: { acct: HlAccount | null }) {
  const ready = Boolean(acct?.user);
  const s = acct?.summary;
  const v = (n: number | undefined, f: (x: number) => string = (x) => fUsd(x)) => (!ready ? "—" : acct!.loaded && n != null ? f(n) : <Skel />);
  return (
    <div className="tacc" id="accCard">
      <div className="h">
        <b>Trading Account</b>
        <span className="live" style={{ color: ready ? "var(--long)" : "var(--dim)" }}>
          ● {ready ? `LIVE${HL.network === "testnet" ? " · TESTNET" : ""}` : "OFFLINE"}
        </span>
      </div>
      <div className="r">
        <span>Available Balance</span>
        <b>{v(s?.withdrawable)}</b>
      </div>
      <div className="r">
        <span>Total Equity</span>
        <b>{v(s?.accountValue)}</b>
      </div>
      <div className="r">
        <span>Unrealized PnL</span>
        <b className={s ? sgn(s.unrealizedPnl) : ""}>{v(s?.unrealizedPnl)}</b>
      </div>
      <div className="r">
        <span>Margin Used</span>
        <b>{v(s?.marginUsed)}</b>
      </div>
      <div className="r">
        <span>Account Leverage</span>
        <b>{v(s?.leverage, (x) => `${x.toFixed(2)}x`)}</b>
      </div>
      {ready && (
        <div className="acts">
          <button className="btn btn-ghost" style={{ height: 38 }} onClick={() => openModal("deposit")}>
            Deposit
          </button>
          <button className="btn btn-ghost" style={{ height: 38 }} onClick={() => openModal("withdraw")}>
            Withdraw
          </button>
        </div>
      )}
    </div>
  );
}

/** The 3-step setup shown in place of the submit button until the account can trade. */
function Checklist({ funded, agent, builder, busy, onEnable }: { funded: boolean; agent: boolean; builder: boolean; busy: boolean; onEnable(): void }) {
  const ck = (done: boolean, cur: boolean, n: number, title: string, sub: string) => (
    <div className={`ck${done ? " done" : cur ? " cur" : ""}`}>
      <i>{done ? "✓" : n}</i>
      <span>
        {title}
        <small>{sub}</small>
      </span>
    </div>
  );
  const enabled = agent && builder;
  return (
    <>
      <div className="checklist">
        <div className="h">
          <span>Set up trading</span>
          <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>
            {[funded, agent, builder].filter(Boolean).length}/3
          </span>
        </div>
        {ck(funded, !funded, 1, "Deposit USDC", "From Arbitrum into your Hyperliquid account")}
        {ck(agent, funded && !agent, 2, "Enable trading", "Approve a trading key that can't withdraw")}
        {ck(builder, funded && agent && !builder, 3, "Approve platform fee", `${pct(BUILDER_RATE)} per trade, signed once`)}
      </div>
      {!funded ? (
        <button className="bigbtn" onClick={() => openModal("deposit")}>
          Deposit USDC
        </button>
      ) : (
        !enabled && (
          <button className="bigbtn" disabled={busy} onClick={onEnable}>
            {busy ? "Confirm in your wallet…" : "Enable trading"}
          </button>
        )
      )}
    </>
  );
}

function useAgentReady(acct: HlAccount, getAgent: () => Promise<unknown>) {
  const [ready, setReady] = useState(false);
  const addr = acct.agentOnChain?.address;
  useEffect(() => {
    let alive = true;
    void getAgent().then((a) => alive && setReady(Boolean(a)));
    return () => {
      alive = false;
    };
  }, [addr, getAgent]);
  return ready;
}

export function OrderPanel({ market }: { market: Market }) {
  const f = useOrderForm();
  const s = useSession();
  const acct = useHlAccount();
  const trading = useTrading(acct);
  const agentReady = useAgentReady(acct, trading.getAgent);
  const mid = useMarkets((st) => st.mids[market.name]) ?? market.px;
  const sheetOpen = useUi((u) => u.sheetOpen);
  const setSheet = useUi((u) => u.setSheet);
  const [levOpen, setLevOpen] = useState(false);
  const [proOpen, setProOpen] = useState(false);
  const [pctV, setPctV] = useState(0);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const name = displayName(market.name);

  // Clamp leverage to the market's max and reset per-market inputs.
  useEffect(() => {
    const st = useOrderForm.getState();
    st.set({ lev: Math.min(st.lev, market.maxLev), px: "", limitPx: "", size: "", tp: "", sl: "", reduceOnly: false, ...(market.onlyIsolated ? { margin: "isolated" } : {}) });
    setPctV(0);
  }, [market.name, market.maxLev, market.onlyIsolated]);

  // Prefill the price box with mid when switching to limit/stop.
  useEffect(() => {
    if (f.otype !== "market" && !f.px && mid) f.set({ px: pxInput(mid) });
    if (f.otype === "stopLimit" && !f.limitPx && mid) f.set({ limitPx: pxInput(mid) });
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
  const margin = f.unit === "margin" ? v : f.unit === "usd" ? v / f.lev : (v * px) / f.lev;
  const est = estimateOrder({ side: f.side, type: f.otype, px, margin, leverage: f.lev, maxLeverage: market.maxLev, builderRate: BUILDER_RATE });
  const baseFee = f.otype === "limit" ? HL_FEES.maker : HL_FEES.taker;
  const available = acct.summary.withdrawable;
  const live = s.status === "ready";
  const canTrade = live && acct.funded && agentReady && acct.builderApproved && TRADING_NETWORK_OK && Boolean(HL.builder.address);

  const cycleUnit = () => {
    const next = UNITS[(UNITS.indexOf(f.unit) + 1) % UNITS.length]!;
    if (!v) return f.set({ unit: next });
    const usd = est.notional;
    const conv = next === "margin" ? usd / f.lev : next === "usd" ? usd : usd / px;
    f.set({ unit: next, size: next === "coin" ? String(+conv.toPrecision(6)) : conv.toFixed(2) });
  };

  const enable = async () => {
    setBusy(true);
    try {
      await trading.enableTrading();
      toast("Trading enabled. You can place orders now.");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!canTrade || busy) return;
    if (!est.notional) return toast("Enter a size", "info");
    if (!f.reduceOnly && est.notional < MIN_ORDER_USD) return toast(`Minimum order value is $${MIN_ORDER_USD}`, "info");
    if (!f.reduceOnly && margin > available * 1.0001) return toast("Not enough available USDC", "info");
    if (HL.network === "mainnet" && !armed) {
      setArmed(true);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), 5000);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      const msg = await trading.placeOrder(
        market,
        {
          side: f.side,
          type: f.otype,
          mid,
          px: parseFloat(f.px) || undefined,
          limitPx: parseFloat(f.limitPx) || undefined,
          size: est.notional / px,
          reduceOnly: f.reduceOnly,
          postOnly: f.otype === "limit" && f.postOnly,
          slippage: f.slippage / 100,
          tp: f.showTpSl ? parseFloat(f.tp) || undefined : undefined,
          sl: f.showTpSl ? parseFloat(f.sl) || undefined : undefined,
        },
        { leverage: f.lev, cross: f.margin === "cross", margin },
      );
      toast(`${f.side === "long" ? "Buy" : "Sell"} ${name}: ${msg}`);
      f.set({ size: "", tp: "", sl: "" });
      setPctV(0);
      setSheet(false);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  let btnText = "";
  let onSubmit: () => void = () => {};
  if (s.status === "anon" || s.status === "loading") {
    btnText = "Sign in to trade";
    onSubmit = () => openModal("wallet");
  } else if (s.status === "needsInvite") {
    btnText = "Enter invite code";
    onSubmit = () => openModal("invite");
  } else {
    const verb = f.side === "long" ? "Buy / Long" : "Sell / Short";
    btnText = busy ? "Sending…" : !est.notional ? "Enter a size" : armed ? `Confirm on MAINNET: ${verb} ${name}` : `${verb} ${name}`;
    onSubmit = submit;
  }

  let blocker: string | null = null;
  if (live && !TRADING_NETWORK_OK) blocker = "Trading is off: market data and orders must use the same Hyperliquid network.";
  else if (live && !HL.builder.address) blocker = "Trading is off: the platform builder address isn't configured.";

  return (
    <aside className={`tord${sheetOpen ? " open" : ""}`} id="tord">
      <div className="sheet-h" onClick={() => setSheet(false)}>
        <span />
      </div>
      <div className="ord-top">
        <button
          onClick={() => {
            if (market.onlyIsolated) return toast(`${name} trades isolated margin only`);
            const next = f.margin === "cross" ? "isolated" : "cross";
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
        <button id="proBtn" className={f.otype === "stop" || f.otype === "stopLimit" ? "on" : ""} onClick={() => (setProOpen((o) => !o), setLevOpen(false))}>
          {f.otype === "stop" ? "Stop ▾" : f.otype === "stopLimit" ? "Stop Limit ▾" : "Pro ▾"}
        </button>
      </div>
      {proOpen && (
        <div className="promenu" id="proMenu">
          <button onClick={() => (setProOpen(false), f.set({ otype: "stop" }))}>Stop Market</button>
          <button onClick={() => (setProOpen(false), f.set({ otype: "stopLimit" }))}>Stop Limit</button>
          {["Scale", "TWAP"].map((t) => (
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
      {live && (
        <div className="avail">
          <span>Available to trade</span>
          <b>{acct.loaded ? fUsd(available) : <Skel />}</b>
        </div>
      )}
      <div className="frow" hidden={f.otype === "market"}>
        <label>
          {f.otype === "stop" || f.otype === "stopLimit" ? "Trigger" : "Price"} <span className="dim">(USDC)</span>
        </label>
        <input inputMode="decimal" placeholder="0.00" value={f.px} onChange={(e) => f.set({ px: num(e.target.value) })} />
        <button className="mini" onClick={() => f.set({ px: pxInput(mid) })}>
          Mid
        </button>
      </div>
      <div className="frow" hidden={f.otype !== "stopLimit"}>
        <label>
          Limit <span className="dim">(USDC)</span>
        </label>
        <input inputMode="decimal" placeholder="0.00" value={f.limitPx} onChange={(e) => f.set({ limitPx: num(e.target.value) })} />
      </div>
      <div className="frow">
        <label>Size</label>
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={f.size}
          onChange={(e) => {
            f.set({ size: num(e.target.value) });
            setPctV(0);
          }}
        />
        <button className="mini" onClick={cycleUnit}>
          {f.unit === "margin" ? "Margin" : f.unit === "usd" ? "USD" : name} ▾
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
            if (!live) {
              setPctV(0);
              return openModal(s.status === "needsInvite" ? "invite" : "wallet");
            }
            const p = +e.target.value;
            setPctV(p);
            const mg = (available * p) / 100;
            const usd = mg * f.lev;
            f.set({ size: mg ? (f.unit === "margin" ? mg.toFixed(2) : f.unit === "usd" ? usd.toFixed(2) : String(+(usd / px).toPrecision(6))) : "" });
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
      <div className="opts" style={{ fontSize: 12.5 }}>
        {f.otype === "limit" ? (
          <label className="ro">
            <span
              className={`sw${f.postOnly ? " on" : ""}`}
              role="switch"
              aria-checked={f.postOnly}
              tabIndex={0}
              onClick={() => f.set({ postOnly: !f.postOnly })}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  f.set({ postOnly: !f.postOnly });
                }
              }}
            />{" "}
            Post Only
          </label>
        ) : (
          <span className="mut">Max slippage</span>
        )}
        {f.otype !== "limit" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[1, 3, 5].map((sl) => (
              <button key={sl} className="mini" style={sl === f.slippage ? { color: "var(--brand)" } : undefined} onClick={() => f.set({ slippage: sl })}>
                {sl}%
              </button>
            ))}
          </span>
        )}
      </div>
      {f.showTpSl && (
        <div className="tp-grid">
          <input className="input" placeholder="Take profit price" inputMode="decimal" value={f.tp} onChange={(e) => f.set({ tp: num(e.target.value) })} />
          <input className="input" placeholder="Stop loss price" inputMode="decimal" value={f.sl} onChange={(e) => f.set({ sl: num(e.target.value) })} />
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
      {blocker ? (
        <p className="note">{blocker}</p>
      ) : live && acct.approvalsLoaded && !(acct.funded && agentReady && acct.builderApproved) ? (
        <Checklist funded={acct.funded} agent={agentReady} builder={acct.builderApproved} busy={busy} onEnable={enable} />
      ) : (
        <button
          className={`bigbtn${live && f.side === "short" ? " s" : ""}${armed ? " mainnet-confirm" : ""}`}
          disabled={live && (busy || !est.notional || !canTrade)}
          onClick={onSubmit}
        >
          {live && !acct.approvalsLoaded ? "Loading account…" : btnText}
        </button>
      )}
      <AccountCard acct={live ? acct : null} />
    </aside>
  );
}
