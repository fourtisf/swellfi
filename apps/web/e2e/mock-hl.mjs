// Local stand-in for the Hyperliquid info API + WebSocket, for UI tests and offline dev.
// Shapes follow the official API. Point the app at it with
//   NEXT_PUBLIC_HL_INFO_URL=http://localhost:4100/info NEXT_PUBLIC_HL_WS_URL=ws://localhost:4100/ws
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_HL_PORT || 4100);

// Prototype mockMarkets: [name, px, maxLev]
const MAIN = [["BTC", 96420, 40, 5], ["ETH", 3480, 25, 4], ["SOL", 212, 20, 2], ["HYPE", 41.2, 10, 2], ["XRP", 2.41, 20, 0], ["DOGE", 0.271, 10, 0], ["PUMP", 0.0061, 5, 0], ["SUI", 4.12, 10, 1], ["AVAX", 38.6, 10, 2], ["LINK", 22.4, 10, 1], ["BNB", 690, 10, 3], ["ENA", 0.82, 10, 0]];
const XYZ = [["xyz:NVDA", 182.4, 10, 3], ["xyz:TSLA", 418.2, 10, 3], ["xyz:SP500", 6620, 20, 3], ["xyz:GOLD", 3840, 20, 3], ["xyz:CL", 64.2, 10, 2]];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mids = {};
const prev = {};
const vol = {};
for (const [n, p] of [...MAIN, ...XYZ]) {
  mids[n] = p;
  prev[n] = p * (1 - (rnd() - 0.5) * 0.08);
  vol[n] = n === "BTC" ? 3.2e9 : n === "ETH" ? 1.6e9 : n.startsWith("xyz:") ? 2e7 * (rnd() * 5 + 1) : 4e8 * (rnd() + 0.2);
}
const str = (v) => String(+v.toPrecision(6));

const metaAndCtxs = (list) => [
  { universe: list.map(([name, , maxLeverage, szDecimals]) => ({ name, szDecimals, maxLeverage, ...(name.includes(":") ? { onlyIsolated: true } : {}) })) },
  list.map(([n]) => ({ funding: str((rnd() - 0.4) * 0.00003), openInterest: str((vol[n] * 0.8) / mids[n]), prevDayPx: str(prev[n]), dayNtlVlm: str(vol[n]), markPx: str(mids[n]), midPx: str(mids[n]), oraclePx: str(mids[n]), premium: "0.0" })),
];

const IV = { "1m": 6e4, "3m": 18e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5, "4h": 144e5, "8h": 288e5, "12h": 432e5, "1d": 864e5 };
function candles(coin, interval, startTime, endTime) {
  const step = IV[interval] ?? 9e5;
  const n = Math.min(500, Math.floor((endTime - startTime) / step));
  const out = [];
  let p = mids[coin] ?? 100;
  const end = Math.floor(endTime / step) * step;
  for (let i = 0; i < n; i++) {
    const t = end - i * step;
    const c = p;
    const o = c / (1 + (rnd() - 0.5) * 0.01);
    out.unshift({ t, T: t + step - 1, s: coin, i: interval, o: str(o), c: str(c), h: str(Math.max(o, c) * (1 + rnd() * 0.003)), l: str(Math.min(o, c) * (1 - rnd() * 0.003)), v: str(rnd() * 1000), n: 10 });
    p = o;
  }
  return out;
}

function book(coin) {
  const p = mids[coin] ?? 100;
  const st = p * 0.00015;
  const sz = () => str(rnd() * 8 / Math.log10(p + 10) + 0.1);
  return { coin, time: Date.now(), levels: [Array.from({ length: 20 }, (_, i) => ({ px: str(p - st * (i + 1)), sz: sz(), n: 3 })), Array.from({ length: 20 }, (_, i) => ({ px: str(p + st * (i + 1)), sz: sz(), n: 3 }))] };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST" || req.url !== "/info") return res.writeHead(404).end();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const b = JSON.parse(body || "{}");
    let out;
    switch (b.type) {
      case "metaAndAssetCtxs":
        out = metaAndCtxs(b.dex === "xyz" ? XYZ : MAIN);
        break;
      case "perpDexs":
        out = [null, { name: "xyz", fullName: "XYZ", deployer: "0x0000000000000000000000000000000000000001" }];
        break;
      case "allMids":
        out = Object.fromEntries(Object.entries(mids).filter(([k]) => (b.dex === "xyz" ? k.startsWith("xyz:") : !k.includes(":"))).map(([k, v]) => [k, str(v)]));
        break;
      case "l2Book":
        out = book(b.coin);
        break;
      case "candleSnapshot":
        out = candles(b.req.coin, b.req.interval, b.req.startTime, b.req.endTime ?? Date.now());
        break;
      default:
        res.writeHead(422).end(`unknown type ${b.type}`);
        return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(out));
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  const subs = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "ping") return ws.send(JSON.stringify({ channel: "pong" }));
    if (m.method === "subscribe") {
      subs.push(m.subscription);
      ws.send(JSON.stringify({ channel: "subscriptionResponse", data: m }));
      if (m.subscription.type === "trades") {
        const p = mids[m.subscription.coin] ?? 100;
        ws.send(JSON.stringify({ channel: "trades", data: Array.from({ length: 12 }, (_, i) => ({ coin: m.subscription.coin, side: rnd() > 0.5 ? "B" : "A", px: str(p * (1 + (rnd() - 0.5) * 0.001)), sz: str(rnd() * 2), time: Date.now() - (12 - i) * 3000, hash: "0x0", tid: i })) }));
      }
    }
    if (m.method === "unsubscribe") {
      const k = JSON.stringify(m.subscription);
      const i = subs.findIndex((s) => JSON.stringify(s) === k);
      if (i >= 0) subs.splice(i, 1);
    }
  });
  const timer = setInterval(() => {
    for (const k in mids) mids[k] *= 1 + (rnd() - 0.5) * 0.0016;
    for (const s of subs) {
      if (s.type === "allMids") {
        const d = Object.fromEntries(Object.entries(mids).filter(([k]) => (s.dex === "xyz" ? k.startsWith("xyz:") : !k.includes(":"))).map(([k, v]) => [k, str(v)]));
        ws.send(JSON.stringify({ channel: "allMids", data: { mids: d } }));
      } else if (s.type === "l2Book") ws.send(JSON.stringify({ channel: "l2Book", data: book(s.coin) }));
      else if (s.type === "trades") ws.send(JSON.stringify({ channel: "trades", data: [{ coin: s.coin, side: rnd() > 0.5 ? "B" : "A", px: str(mids[s.coin]), sz: str(rnd() * 2), time: Date.now(), hash: "0x0", tid: Date.now() }] }));
      else if (s.type === "candle") {
        const step = IV[s.interval] ?? 9e5;
        const t = Math.floor(Date.now() / step) * step;
        const c = mids[s.coin];
        ws.send(JSON.stringify({ channel: "candle", data: { t, T: t + step - 1, s: s.coin, i: s.interval, o: str(c * 0.999), c: str(c), h: str(c * 1.001), l: str(c * 0.998), v: str(rnd() * 100), n: 5 } }));
      }
    }
  }, 1200);
  ws.on("close", () => clearInterval(timer));
});

server.listen(PORT, () => console.log(`mock Hyperliquid on http://localhost:${PORT}/info and ws://localhost:${PORT}/ws`));
