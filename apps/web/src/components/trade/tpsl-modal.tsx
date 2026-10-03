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

/** The position whose TP/SL the modal edits. */
const useTarget = create<{ coin: string | null }>(() => ({ coin: null }));
export const openTpsl = (coin: string) => {
  useTarget.setState({ coin });
  openModal("tpsl");
};

export interface TpslOrders {
  tp?: number;
  sl?: number;
  tpOids: number[];
  slOids: number[];
}

/** Reduce-only triggers resting against each position, by coin. */
export function tpslByCoin(orders: HlAccount["openOrders"]): Record<string, TpslOrders> {
  const out: Record<string, TpslOrders> = {};
  for (const o of orders) {
    if (!o.isTrigger || !o.reduceOnly) continue;
    const e = (out[o.coin] ??= { tpOids: [], slOids: [] });
    if (/take profit/i.test(o.orderType)) {
      e.tp ??= +o.triggerPx;
      e.tpOids.push(o.oid);
    } else if (/stop/i.test(o.orderType)) {
      e.sl ??= +o.triggerPx;
      e.slOids.push(o.oid);
    }
  }
  return out;
}

const TP_PRESETS = [25, 50, 100];
const SL_PRESETS = [10, 25, 50];
const num = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

export function TpslModal(props: { acct: HlAccount; trading: ReturnType<typeof useTrading>; tpsl: Record<string, TpslOrders> }) {
  return (
    <Portal>
      <TpslBody {...props} />
    </Portal>
  );
}

/** TP/SL on an open position: whole position, market on trigger, from the mark price. */
function TpslBody({ acct, trading, tpsl }: { acct: HlAccount; trading: ReturnType<typeof useTrading>; tpsl: Record<string, TpslOrders> }) {
  const coin = useTarget((s) => s.coin);
  const on = useUi((s) => s.modal === "tpsl");
  const close = useUi((s) => s.closeModal);
  const p = acct.positions.find((x) => x.coin === coin);
  const mark = useMarkets((s) => (coin ? s.mids[coin] : undefined));
  const cur = (coin && tpsl[coin]) || { tpOids: [], slOids: [] };
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Start from what's resting each time the modal opens.
  useEffect(() => {
    if (!on) return;
    setTp(cur.tp ? pxInput(cur.tp) : "");
    setSl(cur.sl ? pxInput(cur.sl) : "");
    setErr("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, coin]);

  if (!p) {
    return (
      <Modal name="tpsl" className="glass glow-border wide-short">
        <h3>TP/SL</h3>
        <p className="mut">This position is closed.</p>
      </Modal>
    );
  }

  const long = p.szi > 0;
  const size = Math.abs(p.szi);
  const ref = mark ?? p.entryPx;
  // Gain/loss relative to the margin put up at entry, like the exchange shows it.
  const margin0 = (p.entryPx * size) / p.leverage.value;
  const pnlAt = (x: number) => (x - p.entryPx) * p.szi;
  const priceFor = (roe: number) => p.entryPx + (roe / 100) * (margin0 / p.szi);

  const check = (raw: string, kind: "tp" | "sl"): string | null => {
    if (!raw) return null;
    const x = +raw;
    if (!(x > 0)) return "Enter a valid price";
    const above = (kind === "tp") === long;
    if (above ? x <= ref : x >= ref) return `${kind === "tp" ? "Take profit" : "Stop loss"} must be ${above ? "above" : "below"} the mark price (${fPx(ref)})`;
    if (kind === "sl" && p.liquidationPx && (long ? x <= p.liquidationPx : x >= p.liquidationPx)) return `Past the liquidation price (${fPx(p.liquidationPx)}): it would never trigger`;
    return null;
  };
  const tpErr = check(tp, "tp");
  const slErr = check(sl, "sl");
  const tpNew = tp ? +tp : undefined;
  const slNew = sl ? +sl : undefined;
  const same = (a: number | undefined, b: number | undefined) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-9 * Math.max(1, a));
  const tpChanged = !same(tpNew, cur.tp);
  const slChanged = !same(slNew, cur.sl);

  const save = async () => {
    if (tpErr || slErr || busy) return;
    setBusy(true);
    setErr("");
    try {
      await trading.setPositionTpsl(p, { tp: tpChanged ? tpNew : undefined, sl: slChanged ? slNew : undefined }, [...(tpChanged ? cur.tpOids : []), ...(slChanged ? cur.slOids : [])]);
      close();
      toast(`${displayName(p.coin)}: TP/SL ${tpNew || slNew ? "saved" : "removed"}`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (kind: "tp" | "sl", value: string, set: (v: string) => void, error: string | null, had: number | undefined, presets: number[]) => {
    const x = +value;
    const pnl = value && !error ? pnlAt(x) : null;
    return (
      <div className="field tpsl-field">
        {/* Not a <label>: it holds buttons, and a click on the title would press the first one. */}
        <div className="tpsl-head">
          <span>{kind === "tp" ? "Take profit" : "Stop loss"}</span>
          <span className="tpsl-presets">
            {presets.map((r) => {
              const roe = kind === "tp" ? r : -r;
              const at = priceFor(roe);
              // A stop past liquidation is useless, so its preset isn't offered.
              if (kind === "sl" && p.liquidationPx && (long ? at <= p.liquidationPx : at >= p.liquidationPx)) return null;
              return (
                <button key={r} type="button" className="mini" disabled={busy} onClick={() => set(pxInput(at))}>
                  {roe > 0 ? "+" : "−"}
                  {r}%
                </button>
              );
            })}
          </span>
        </div>
        <div className="wrap">
          <input className="input" aria-label={`${kind === "tp" ? "Take profit" : "Stop loss"} price`} placeholder={`${kind === "tp" ? "Take profit" : "Stop loss"} price`} inputMode="decimal" value={value} disabled={busy} onChange={(e) => set(num(e.target.value))} />
          {value && (
            <button type="button" className="tpsl-clear" aria-label={`Clear ${kind === "tp" ? "take profit" : "stop loss"}`} disabled={busy} onClick={() => set("")}>
              ✕
            </button>
          )}
        </div>
        <small className={error ? "dn" : pnl != null ? sgn(pnl) : "dim"}>
          {error ?? (pnl != null ? `≈ ${fUsd(pnl)} (${fPct((pnl / margin0) * 100, 1)}) if it triggers` : had ? `Removes the ${kind === "tp" ? "take profit" : "stop loss"} at ${fPx(had)}` : "Not set")}
        </small>
      </div>
    );
  };

  return (
    <Modal name="tpsl" className="glass glow-border wide-short">
      <h3>
        TP/SL · {displayName(p.coin)} <span className={`pill ${long ? "l" : "s"}`}>{long ? "Long" : "Short"}</span>
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
          <small>Liq. price</small>
          <b style={{ color: "#F5B53D" }}>{p.liquidationPx ? fPx(p.liquidationPx) : "—"}</b>
        </div>
      </div>
      {field("tp", tp, setTp, tpErr, cur.tp, TP_PRESETS)}
      {field("sl", sl, setSl, slErr, cur.sl, SL_PRESETS)}
      <p className="dim tpsl-note">Closes the whole position at market when the mark price reaches the trigger, including anything you add to it later. Percentages are of the margin at entry.</p>
      {err && <p className="err">{err}</p>}
      <button className="btn btn-brand submit" disabled={busy || Boolean(tpErr || slErr) || !(tpChanged || slChanged)} onClick={save}>
        {busy ? "Saving…" : "Confirm"}
      </button>
    </Modal>
  );
}
