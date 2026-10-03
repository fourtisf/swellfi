"use client";

import { displayName } from "@swellfi/hl";
import { fPct, fPx, fUsd, pxInput, sgn } from "@swellfi/ui";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { useMarkets } from "@/lib/market";
import type { HlAccount } from "@/lib/trading/account";
import { errMsg, type useTrading } from "@/lib/trading/use-trading";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { Modal } from "../modal";
import { Portal } from "../portal";

const useTarget = create<{ coin: string | null }>(() => ({ coin: null }));
export const openClose = (coin: string) => {
  useTarget.setState({ coin });
  openModal("close");
};

const PRESETS = [25, 50, 75, 100];
const num = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

export function CloseModal(props: { acct: HlAccount; trading: ReturnType<typeof useTrading> }) {
  return (
    <Portal>
      <CloseBody {...props} />
    </Portal>
  );
}

/** Close all or part of a position, at market or with a reduce-only limit order. */
function CloseBody({ acct, trading }: { acct: HlAccount; trading: ReturnType<typeof useTrading> }) {
  const coin = useTarget((s) => s.coin);
  const on = useUi((s) => s.modal === "close");
  const close = useUi((s) => s.closeModal);
  const p = acct.positions.find((x) => x.coin === coin);
  const mark = useMarkets((s) => (coin ? s.mids[coin] : undefined));
  const szDec = useMarkets((s) => (coin ? s.byName[coin]?.szDecimals : undefined)) ?? 4;
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [pct, setPct] = useState("100");
  const [px, setPx] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!on) return;
    setKind("market");
    setPct("100");
    setPx(mark ? pxInput(mark) : "");
    setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, coin]);

  if (!p) {
    return (
      <Modal name="close" className="glass glow-border wide-short">
        <h3>Close position</h3>
        <p className="mut">This position is already closed.</p>
      </Modal>
    );
  }

  const long = p.szi > 0;
  const total = Math.abs(p.szi);
  const ref = mark ?? p.entryPx;
  const f = Math.min(100, +pct || 0) / 100;
  // Hyperliquid sizes are whole lots: round down like the order builder does.
  const lot = 10 ** -szDec;
  const size = f >= 1 ? total : Math.floor((total * f) / lot + 1e-9) * lot;
  const limitPx = +px;
  const at = kind === "limit" ? limitPx : ref;
  const pnl = (at - p.entryPx) * (long ? size : -size);
  const margin0 = (p.entryPx * size) / p.leverage.value;
  // A limit already through the market fills right away (at that price or better).
  const fillsNow = kind === "limit" && limitPx > 0 && (long ? limitPx <= ref : limitPx >= ref);

  let problem: string | null = null;
  if (!(f > 0)) problem = "Choose how much to close";
  else if (size < lot / 2) problem = `Below the minimum size of ${lot.toFixed(szDec)} ${displayName(p.coin)}`;
  else if (kind === "limit" && !(limitPx > 0)) problem = "Enter a limit price";

  const confirm = async () => {
    if (problem || busy) return;
    setBusy(true);
    setErr("");
    try {
      // All of it: the fraction, so it matches the position exactly; part: the size in whole lots.
      const r = await trading.closePosition(p, 1, kind === "limit" ? limitPx : undefined, f >= 1 ? undefined : size);
      close();
      toast(kind === "limit" && r === "Order placed" ? `${displayName(p.coin)}: limit close placed at ${fPx(limitPx)}` : `Close ${displayName(p.coin)}: ${r}`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const share = f >= 1 ? "all" : `${+(f * 100).toFixed(2)}%`;
  return (
    <Modal name="close" className="glass glow-border wide-short">
      <h3>
        Close · {displayName(p.coin)} <span className={`pill ${long ? "l" : "s"}`}>{long ? "Long" : "Short"}</span>
      </h3>
      <div className="tpsl-kv">
        <div>
          <small>Entry</small>
          <b>{fPx(p.entryPx)}</b>
        </div>
        <div>
          <small>Mark</small>
          <b>{fPx(ref)}</b>
        </div>
        <div>
          <small>Size</small>
          <b>{fUsd(p.positionValue)}</b>
        </div>
        <div>
          <small>PnL</small>
          <b className={sgn(p.unrealizedPnl)}>{fUsd(p.unrealizedPnl)}</b>
        </div>
      </div>

      <div className="seg close-kind" role="tablist">
        {(["market", "limit"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} disabled={busy} onClick={() => setKind(k)}>
            {k === "market" ? "Market" : "Limit"}
          </button>
        ))}
      </div>

      {kind === "limit" && (
        <div className="field tpsl-field">
          <div className="tpsl-head">
            <span>Limit price</span>
            <span className="tpsl-presets">
              <button type="button" className="mini" disabled={busy || !mark} onClick={() => mark && setPx(pxInput(mark))}>
                Mid
              </button>
            </span>
          </div>
          <div className="wrap">
            <input className="input" aria-label="Limit price" placeholder="Limit price" inputMode="decimal" value={px} disabled={busy} onChange={(e) => setPx(num(e.target.value))} />
            <span>USDC</span>
          </div>
        </div>
      )}

      <div className="field tpsl-field">
        <div className="tpsl-head">
          <span>Amount</span>
          <span className="tpsl-presets">
            {PRESETS.map((v) => (
              <button key={v} type="button" className={`mini${+pct === v ? " on" : ""}`} disabled={busy} onClick={() => setPct(String(v))}>
                {v}%
              </button>
            ))}
          </span>
        </div>
        <div className="wrap">
          <input className="input" aria-label="Percent of the position" inputMode="decimal" value={pct} disabled={busy} onChange={(e) => setPct(num(e.target.value))} />
          <span>%</span>
        </div>
        <small className={problem ? "dn" : "dim"}>
          {problem ??
            `${size.toFixed(szDec)} of ${total.toFixed(szDec)} ${displayName(p.coin)} · ≈ ${fUsd(size * at)}`}
        </small>
      </div>

      {!problem && (
        <p className={`close-est ${sgn(pnl)}`}>
          Est. PnL {fUsd(pnl)} <small>({fPct((pnl / margin0) * 100, 1)})</small>
          <span className="dim"> before fees</span>
        </p>
      )}
      <p className="dim tpsl-note">
        {kind === "market"
          ? "Closes now at the best available price (reduce-only)."
          : fillsNow
            ? "This price is already through the market: it fills right away at this price or better."
            : "Waits in Open Orders until the price reaches it. Reduce-only: it can only close, never open or flip."}
      </p>
      {err && <p className="err">{err}</p>}
      <button className="btn btn-brand submit" disabled={busy || Boolean(problem)} onClick={confirm}>
        {busy ? "Sending…" : kind === "market" ? `Close ${share} at market` : `Place limit close (${share})`}
      </button>
    </Modal>
  );
}
