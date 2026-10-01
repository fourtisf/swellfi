"use client";

import type { L2Book, RawTrade, Trade } from "@tideline/hl";
import { fPx, pxInput } from "@tideline/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMediaQuery } from "@/lib/hooks";
import { getSocket, info, useMarkets } from "@/lib/market";
import { useOrderForm } from "./order-store";

export type BookPanel = "book" | "trades" | "depth";

interface Lvl {
  px: number;
  sz: number;
  cum: number;
}

const cumulate = (levels: { px: string; sz: string }[], n: number): Lvl[] => {
  let c = 0;
  return levels.slice(0, n).map((l) => ({ px: +l.px, sz: +l.sz, cum: (c += +l.sz) }));
};

/** Live order book + trades for one coin (shared by the book, trades and depth views). */
function useCoinFeed(coin: string) {
  const [book, setBook] = useState<L2Book["levels"] | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    let alive = true;
    setBook(null);
    setTrades([]);
    info
      .l2Book(coin)
      .then((b) => alive && setBook((cur) => cur ?? b.levels))
      .catch(() => {});
    const s = getSocket();
    const offBook = s.subscribe({ type: "l2Book", coin }, (m) => alive && setBook((m.data as L2Book).levels));
    const offTrades = s.subscribe({ type: "trades", coin }, (m) => {
      if (!alive) return;
      const incoming = (m.data as RawTrade[]).map((t) => ({ side: t.side, px: +t.px, sz: +t.sz, time: t.time }));
      setTrades((cur) => [...incoming.reverse(), ...cur].slice(0, 40));
    });
    return () => {
      alive = false;
      offBook();
      offTrades();
    };
  }, [coin]);
  return { book, trades };
}

function Depth({ book, coin }: { book: L2Book["levels"]; coin: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const mid = useMarkets((s) => s.mids[coin]);
  useEffect(() => {
    const el = cv.current;
    if (!el || !el.offsetWidth) return;
    const d = devicePixelRatio || 1;
    const W = el.offsetWidth;
    const H = el.offsetHeight;
    el.width = W * d;
    el.height = H * d;
    const x = el.getContext("2d")!;
    x.scale(d, d);
    const b = cumulate(book[0], 20);
    const a = cumulate(book[1], 20);
    if (!b.length || !a.length) return;
    const cb = b[b.length - 1]!.cum;
    const ca = a[a.length - 1]!.cum;
    const lo = b[b.length - 1]!.px;
    const hi = a[a.length - 1]!.px;
    const mx = Math.max(cb, ca);
    const X = (p: number) => ((p - lo) / (hi - lo || 1)) * W;
    const Y = (v: number) => H - 24 - (v / mx) * (H - 60);
    const side = (arr: Lvl[], col: string, fill: string) => {
      x.beginPath();
      x.moveTo(X(arr[0]!.px), H - 24);
      arr.forEach((l) => x.lineTo(X(l.px), Y(l.cum)));
      x.lineTo(X(arr[arr.length - 1]!.px), H - 24);
      x.closePath();
      x.fillStyle = fill;
      x.fill();
      x.beginPath();
      arr.forEach((l, i) => (i ? x.lineTo(X(l.px), Y(l.cum)) : x.moveTo(X(l.px), Y(l.cum))));
      x.strokeStyle = col;
      x.lineWidth = 1.6;
      x.stroke();
    };
    side(b, "#16C784", "rgba(22,199,132,.18)");
    side(a, "#EA3943", "rgba(234,57,67,.18)");
    x.fillStyle = "#8D9699";
    x.font = "11px Inter, system-ui, sans-serif";
    x.textAlign = "left";
    x.fillText(fPx(lo), 6, H - 8);
    x.textAlign = "right";
    x.fillText(fPx(hi), W - 6, H - 8);
    x.textAlign = "center";
    x.fillStyle = "#ECEFF0";
    x.font = "600 12px Inter, system-ui, sans-serif";
    x.fillText(fPx(mid), W / 2, 18);
    x.fillStyle = "#8D9699";
    x.font = "11px Inter, system-ui, sans-serif";
    x.fillText(`Bids ${cb.toFixed(2)}  ·  Asks ${ca.toFixed(2)}`, W / 2, 34);
  }, [book, mid]);
  return <canvas id="depth" ref={cv} />;
}

export function BookColumn({ coin, display, panel, onPanel, open }: { coin: string; display: string; panel: BookPanel; onPanel(p: BookPanel): void; open: boolean }) {
  const { book, trades } = useCoinFeed(coin);
  const small = useMediaQuery("(max-width: 900px)");
  const setForm = useOrderForm((s) => s.set);
  const fallbackMid = useMarkets((s) => s.mids[coin]);

  let body: ReactNode;
  if (panel === "trades") {
    body = (
      <>
        <div className="brow hdr">
          <span>Price</span>
          <span>Size</span>
          <span>Time</span>
        </div>
        {trades.length ? (
          trades.slice(0, 34).map((t, i) => (
            <div className="brow" key={`${t.time}-${i}`}>
              <span className={t.side === "B" ? "up" : "dn"}>{fPx(t.px)}</span>
              <span>{t.sz.toFixed(t.sz < 1 ? 4 : 2)}</span>
              <span className="dim">{new Date(t.time).toLocaleTimeString("en-US", { hour12: false })}</span>
            </div>
          ))
        ) : (
          <div className="empty">Waiting for trades…</div>
        )}
      </>
    );
  } else if (!book) {
    body = <div className="empty">Loading order book…</div>;
  } else if (panel === "depth") {
    body = <Depth book={book} coin={coin} />;
  } else {
    const N = small ? 6 : 11;
    const b = cumulate(book[0], N);
    const a = cumulate(book[1], N);
    const cb = b[b.length - 1]?.cum ?? 0;
    const ca = a[a.length - 1]?.cum ?? 0;
    const mx = Math.max(cb, ca) || 1;
    const sp = a[0] && b[0] ? a[0].px - b[0].px : 0;
    const mid = a[0] && b[0] ? (a[0].px + b[0].px) / 2 : (fallbackMid ?? 0);
    const bp = (cb / (cb + ca || 1)) * 100;
    const row = (l: Lvl, s: "a" | "b") => (
      <div className={`brow ${s}`} key={`${s}${l.px}`} style={{ cursor: "pointer" }} onClick={() => setForm({ otype: "limit", px: pxInput(l.px) })}>
        <i style={{ width: `${((l.cum / mx) * 100).toFixed(1)}%` }} />
        <span className={s === "a" ? "dn" : "up"}>{fPx(l.px)}</span>
        <span>{l.sz.toFixed(l.sz < 10 ? 3 : 1)}</span>
        <span className="mut">{l.cum.toFixed(l.cum < 10 ? 3 : 1)}</span>
      </div>
    );
    body = (
      <>
        <div className="brow hdr">
          <span>Price</span>
          <span>Size ({display})</span>
          <span>Total</span>
        </div>
        {[...a].reverse().map((l) => row(l, "a"))}
        <div className="spread">
          <b>{fPx(mid)}</b>
          <span>Spread {mid ? ((sp / mid) * 100).toFixed(3) : "0.000"}%</span>
        </div>
        {b.map((l) => row(l, "b"))}
        <div style={{ padding: "10px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 6 }}>
            <span className="up">B {bp.toFixed(0)}%</span>
            <span className="dn">{(100 - bp).toFixed(0)}% S</span>
          </div>
          <div style={{ display: "flex", height: 4, borderRadius: 9, overflow: "hidden" }}>
            <i style={{ width: `${bp}%`, background: "var(--long)" }} />
            <i style={{ flex: 1, background: "var(--short)" }} />
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="bookcol" hidden={!open}>
      <div className="book-tabs" role="tablist">
        {(
          [
            ["book", "Order book"],
            ["trades", "Trades"],
            ["depth", "Depth"],
          ] as [BookPanel, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={panel === k} className={panel === k ? "on" : ""} onClick={() => onPanel(k)}>
            {label}
          </button>
        ))}
      </div>
      <div id="bookBody" className="book">
        {body}
      </div>
    </div>
  );
}
