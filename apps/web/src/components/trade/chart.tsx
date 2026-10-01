"use client";

import { INTERVAL_MS, toCandle, type Candle, type CandleInterval } from "@swellfi/hl";
import { fPct, fPx, Icon, type IconName } from "@swellfi/ui";
import {
  ColorType,
  createChart,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { getSocket, info } from "@/lib/market";
import { toast } from "@/lib/ui-store";

const IVS: [CandleInterval, string][] = [
  ["1m", "1m"],
  ["5m", "5m"],
  ["15m", "15m"],
  ["1h", "1h"],
  ["4h", "4h"],
  ["1d", "D"],
];

const decimalsFor = (p: number) => {
  const a = Math.abs(p);
  return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 7;
};

const sec = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const pad = (n: number) => String(n).padStart(2, "0");

/** Local-time axis labels like the prototype canvas chart. */
function tickLabel(t: Time, type: TickMarkType) {
  const d = new Date((t as number) * 1000);
  if (type === TickMarkType.Year) return String(d.getFullYear());
  if (type === TickMarkType.Month || type === TickMarkType.DayOfMonth) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Tool({ icon, title, on }: { icon: IconName; title: string; on?: boolean }) {
  return (
    <button className={`tool${on ? " on" : ""}`} title={title} onClick={() => toast(`${title} arrive with the full charting package`)}>
      <Icon name={icon} size={16} />
    </button>
  );
}

/**
 * Candle chart (lightweight-charts; TradingView Advanced Charts can replace it once the
 * licence is approved). Snapshot from candleSnapshot, live updates from the WS `candle` feed.
 */
export interface ChartLine {
  price: number;
  color: string;
  title: string;
}

export function PriceChart({ coin, displayName, lines = [] }: { coin: string; displayName: string; lines?: ChartLine[] }) {
  const [iv, setIv] = useState<CandleInterval>("15m");
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const series = useRef<{ c: ISeriesApi<"Candlestick">; v: ISeriesApi<"Histogram">; a: ISeriesApi<"Area"> } | null>(null);
  const candles = useRef<Candle[]>([]);
  const [hover, setHover] = useState<Candle | null>(null);
  const [last, setLast] = useState<Candle | null>(null);
  const [bars, setBars] = useState(0);
  const [clock, setClock] = useState("");

  // Create the chart once.
  useEffect(() => {
    const el = box.current!;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#070B14" }, textColor: "#5A6680", fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 },
      grid: { vertLines: { color: "rgba(150,185,215,.04)" }, horzLines: { color: "rgba(150,185,215,.06)" } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 }, minimumWidth: 74 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickLabel, rightOffset: 4 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(77,181,255,.45)", style: LineStyle.Dashed, labelBackgroundColor: "#1D3B66" },
        horzLine: { color: "rgba(77,181,255,.45)", style: LineStyle.Dashed, labelBackgroundColor: "#1D3B66" },
      },
      localization: {
        priceFormatter: (p: number) => fPx(p),
        timeFormatter: (t: Time) => new Date((t as number) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
      },
    });
    const a = chart.addAreaSeries({
      lineColor: "rgba(0,0,0,0)",
      topColor: "rgba(77,181,255,.16)",
      bottomColor: "rgba(77,181,255,0)",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const v = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const c = chart.addCandlestickSeries({
      upColor: "#16C784",
      downColor: "#EA3943",
      borderVisible: false,
      wickUpColor: "#16C784",
      wickDownColor: "#EA3943",
      priceLineStyle: LineStyle.Dashed,
    });
    chart.subscribeCrosshairMove((p) => {
      const d = p.time != null ? p.seriesData.get(c) : undefined;
      if (!d || !("open" in d)) return setHover(null);
      const k = candles.current.find((x) => sec(x.t) === p.time);
      setHover(k ?? null);
    });
    chartRef.current = chart;
    series.current = { c, v, a };
    return () => {
      chart.remove();
      chartRef.current = null;
      series.current = null;
    };
  }, []);

  // Load + stream candles for coin/interval.
  useEffect(() => {
    let alive = true;
    const s = series.current!;
    const push = (k: Candle, replace: boolean) => {
      const up = k.c >= k.o;
      const t = sec(k.t);
      s.c.update({ time: t, open: k.o, high: k.h, low: k.l, close: k.c });
      s.v.update({ time: t, value: k.v, color: up ? "rgba(62,230,164,.2)" : "rgba(255,107,134,.2)" });
      s.a.update({ time: t, value: k.c });
      if (!replace) setBars(candles.current.length);
      setLast(k);
    };
    candles.current = [];
    s.c.setData([]);
    s.v.setData([]);
    s.a.setData([]);
    setLast(null);
    setBars(0);

    const end = Date.now();
    info
      .candleSnapshot(coin, iv, end - INTERVAL_MS[iv] * 300, end)
      .then((list) => {
        if (!alive || !series.current) return;
        // Merge with anything the socket delivered while the snapshot was in flight.
        const byT = new Map(list.map((k) => [k.t, k]));
        for (const k of candles.current) byT.set(k.t, k);
        const all = [...byT.values()].sort((x, y) => x.t - y.t);
        candles.current = all;
        const d = decimalsFor(all[all.length - 1]?.c ?? 1);
        s.c.applyOptions({ priceFormat: { type: "price", precision: d, minMove: 10 ** -d } });
        s.c.setData(all.map((k) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c })));
        s.v.setData(all.map((k) => ({ time: sec(k.t), value: k.v, color: k.c >= k.o ? "rgba(62,230,164,.2)" : "rgba(255,107,134,.2)" })));
        s.a.setData(all.map((k) => ({ time: sec(k.t), value: k.c })));
        chartRef.current?.timeScale().fitContent();
        setLast(all[all.length - 1] ?? null);
        setBars(all.length);
      })
      .catch(() => alive && toast("Couldn't load chart data"));

    const off = getSocket().subscribe({ type: "candle", coin, interval: iv }, (m) => {
      if (!alive) return;
      const k = toCandle(m.data);
      const list = candles.current;
      const L = list[list.length - 1];
      if (L && L.t === k.t) {
        list[list.length - 1] = k;
        push(k, true);
      } else if (!L || k.t > L.t) {
        list.push(k);
        push(k, false);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [coin, iv]);

  // Position entry / liquidation lines.
  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    const c = series.current?.c;
    if (!c) return;
    const made: IPriceLine[] = lines.map((l) => c.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title }));
    return () => made.forEach((pl) => c.removePriceLine(pl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  useEffect(() => {
    const tick = () => {
      const off = -new Date().getTimezoneOffset() / 60;
      setClock(`${new Date().toLocaleTimeString("en-GB", { hour12: false })} (UTC${off >= 0 ? "+" : ""}${off})`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const k = hover ?? last;
  const cc = k && k.c >= k.o ? "up" : "dn";
  return (
    <div className="chartcol">
      <div className="ctool">
        <Tool icon="pen" title="Drawing tools" />
        <span className="sep" />
        <div className="ivs">
          {IVS.map(([key, label]) => (
            <button key={key} className={iv === key ? "on" : ""} onClick={() => setIv(key)}>
              {label}
            </button>
          ))}
        </div>
        <Tool icon="plus" title="More intervals" />
        <span className="sep" />
        <Tool icon="candle" title="Chart types" on />
        <Tool icon="fx" title="Indicators" />
      </div>
      <div className="chart-wrap">
        <div className="ohlc ohlc-float">
          {k ? (
            <>
              O <span className={cc}>{fPx(k.o)}</span> &nbsp; H <span className={cc}>{fPx(k.h)}</span> &nbsp; L <span className={cc}>{fPx(k.l)}</span> &nbsp; C{" "}
              <span className={cc}>{fPx(k.c)}</span> &nbsp; <span className={cc}>{fPct((k.c / k.o - 1) * 100)}</span>
            </>
          ) : (
            "Loading…"
          )}
        </div>
        <div className="lw" ref={box} />
        <div className="cfoot">
          {bars} bars · {displayName} · {clock}
        </div>
      </div>
    </div>
  );
}
