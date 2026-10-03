// Local stand-in for Hyperliquid (info + exchange + WebSocket) and an Arbitrum JSON-RPC, for
// offline development and end-to-end tests. It behaves like the real exchange where it matters
// for our app:
//   - every /exchange request is signature-checked exactly like Hyperliquid does (L1 actions:
//     phantom-agent EIP-712 over the msgpack action hash; user-signed actions: EIP-712 with
//     HyperliquidSignTransaction domain), and the signer must be the user or an approved agent
//   - orders must carry a builder the user approved (≥ the order's fee), except orders placed by
//     the builder itself (MOCK_HL_BUILDER) or while the builder can't be approved; a builder can
//     only be approved while it holds at least 100 USDC of perps account value (it starts with 100)
//   - simple matching: IOC/market and crossing limits fill at mid, resting limits and triggers
//     fill when the (mock) price crosses them; TP/SL children activate after the entry fills
// Point the app at it with
//   NEXT_PUBLIC_HL_INFO_URL=http://localhost:4100/info NEXT_PUBLIC_HL_WS_URL=ws://localhost:4100/ws
//   NEXT_PUBLIC_ARB_RPC_URL=http://localhost:4100/rpc
// Test hooks: POST /__mock/price {coin, px}, POST /__mock/deposit {user, amount},
//   POST /__mock/usdc {user, amount} (sets the main-dex balance), GET /__mock/state
import http from "node:http";
import { createL1ActionHash } from "@nktkas/hyperliquid/signing";
import { decodeFunctionData, keccak256, recoverTypedDataAddress, toHex } from "viem";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_HL_PORT || 4100);
const IS_TESTNET = process.env.MOCK_HL_NETWORK !== "mainnet";
const ARB_CHAIN_ID = IS_TESTNET ? 421614 : 42161;
const BRIDGE = (IS_TESTNET ? "0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89" : "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7").toLowerCase();
const USDC = (IS_TESTNET ? "0x1baAbB04529D43a73232B713C0FE471f7c7334d5" : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831").toLowerCase();
const FEES = { taker: 0.00045, maker: 0.00015 };
const BUILDER = (process.env.MOCK_HL_BUILDER || "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266").toLowerCase();
const MIN_BUILDER_VALUE = 100;

// ---------------- Markets ----------------
// [name, px, maxLeverage, szDecimals]
const MAIN = [["BTC", 96420, 40, 5], ["ETH", 3480, 25, 4], ["SOL", 212, 20, 2], ["HYPE", 41.2, 10, 2], ["XRP", 2.41, 20, 0], ["DOGE", 0.271, 10, 0], ["PUMP", 0.0061, 5, 0], ["SUI", 4.12, 10, 1], ["AVAX", 38.6, 10, 2], ["LINK", 22.4, 10, 1], ["BNB", 690, 10, 3], ["ENA", 0.82, 10, 0], ["kPEPE", 0.0121, 10, 0], ["FARTCOIN", 1.12, 10, 1], ["ARB", 0.71, 10, 1], ["OP", 1.62, 10, 1], ["TIA", 4.4, 10, 1], ["LTC", 102, 10, 2], ["AAVE", 268, 10, 2], ["UNI", 9.8, 10, 1], ["TRUMP", 14.2, 10, 1], ["PENGU", 0.031, 5, 0]];
const XYZ = [["xyz:NVDA", 182.4, 10, 3], ["xyz:TSLA", 418.2, 10, 3], ["xyz:SP500", 6620, 20, 3], ["xyz:GOLD", 3840, 20, 3], ["xyz:CL", 64.2, 10, 2], ["xyz:XYZ100", 24800, 20, 3], ["xyz:AAPL", 238.1, 10, 3], ["xyz:MSFT", 512.4, 10, 3], ["xyz:GOOGL", 245.3, 10, 3], ["xyz:AMZN", 226.7, 10, 3], ["xyz:META", 748.2, 10, 3], ["xyz:COIN", 342.5, 10, 3], ["xyz:SILVER", 46.8, 20, 2], ["xyz:NATGAS", 3.12, 10, 2], ["xyz:EUR", 1.172, 20, 1]];
const ASSET = new Map(); // assetId -> {name, dex, szDecimals, maxLev}
MAIN.forEach(([n, , l, d], i) => ASSET.set(i, { name: n, dex: "", szDecimals: d, maxLev: l }));
XYZ.forEach(([n, , l, d], i) => ASSET.set(110000 + i, { name: n, dex: "xyz", szDecimals: d, maxLev: l }));
const BY_NAME = new Map([...ASSET.entries()].map(([id, a]) => [a.name, { ...a, id }]));

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mids = {};
const prev = {};
const vol = {};
for (const [n, p] of [...MAIN, ...XYZ]) {
  mids[n] = p;
  prev[n] = p * (1 - (rnd() - 0.5) * 0.08);
  vol[n] = n === "BTC" ? 3.2e9 : n === "ETH" ? 1.6e9 : n.startsWith("xyz:") ? 2e7 * (rnd() * 5 + 1) : 4e8 * (rnd() + 0.2);
}
const pinned = new Set(); // coins whose price is set by a test and must not drift
const str = (v) => String(+(+v).toPrecision(6));

const metaAndCtxs = (list) => [
  { universe: list.map(([name, , maxLeverage, szDecimals]) => ({ name, szDecimals, maxLeverage, ...(name.includes(":") ? { onlyIsolated: true } : {}) })), collateralToken: 0 },
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
  const sz = () => str((rnd() * 8) / Math.log10(p + 10) + 0.1);
  return { coin, time: Date.now(), levels: [Array.from({ length: 20 }, (_, i) => ({ px: str(p - st * (i + 1)), sz: sz(), n: 3 })), Array.from({ length: 20 }, (_, i) => ({ px: str(p + st * (i + 1)), sz: sz(), n: 3 }))] };
}

// ---------------- Accounts ----------------
const accounts = new Map(); // user -> account
const agentOwner = new Map(); // agent address -> user
// Start from the clock so ids (and fill hashes) never repeat across mock restarts, like on
// Hyperliquid: the indexer deduplicates fills by them.
let nextOid = Date.now();
let nextTid = Date.now();
const events = []; // { user, channel } for WS pushes

function acct(user) {
  const u = user.toLowerCase();
  if (!accounts.has(u)) accounts.set(u, { user: u, usdc: { "": 0, xyz: 0 }, positions: new Map(), orders: [], fills: [], history: [], agents: [], builders: new Map(), leverage: new Map(), withdrawals: [], ledger: [] });
  return accounts.get(u);
}
acct(BUILDER).usdc[""] = MIN_BUILDER_VALUE;

function upnl(p) {
  return p.szi * ((mids[p.coin] ?? p.entryPx) - p.entryPx);
}

function clearinghouse(a, dex) {
  const ps = [...a.positions.values()].filter((p) => BY_NAME.get(p.coin).dex === dex && p.szi !== 0);
  const margin = ps.reduce((s, p) => s + (Math.abs(p.szi) * p.entryPx) / p.lev, 0);
  const ntl = ps.reduce((s, p) => s + Math.abs(p.szi) * (mids[p.coin] ?? p.entryPx), 0);
  const pnl = ps.reduce((s, p) => s + upnl(p), 0);
  const balance = a.usdc[dex] ?? 0;
  const accountValue = balance + pnl;
  return {
    assetPositions: ps.map((p) => {
      const mark = mids[p.coin];
      const mmr = 1 / (2 * BY_NAME.get(p.coin).maxLev);
      const liq = p.entryPx * (1 - Math.sign(p.szi) * (1 / p.lev - mmr));
      return {
        type: "oneWay",
        position: {
          coin: p.coin,
          szi: str(p.szi),
          entryPx: str(p.entryPx),
          positionValue: (Math.abs(p.szi) * mark).toFixed(4),
          unrealizedPnl: upnl(p).toFixed(4),
          returnOnEquity: (upnl(p) / ((Math.abs(p.szi) * p.entryPx) / p.lev)).toFixed(6),
          liquidationPx: str(liq),
          marginUsed: ((Math.abs(p.szi) * p.entryPx) / p.lev).toFixed(4),
          leverage: { type: p.cross ? "cross" : "isolated", value: p.lev },
          maxLeverage: BY_NAME.get(p.coin).maxLev,
          cumFunding: { allTime: "0", sinceOpen: "0", sinceChange: "0" },
        },
      };
    }),
    marginSummary: { accountValue: accountValue.toFixed(4), totalMarginUsed: margin.toFixed(4), totalNtlPos: ntl.toFixed(4), totalRawUsd: balance.toFixed(4) },
    crossMarginSummary: { accountValue: accountValue.toFixed(4), totalMarginUsed: margin.toFixed(4), totalNtlPos: ntl.toFixed(4), totalRawUsd: balance.toFixed(4) },
    crossMaintenanceMarginUsed: (margin / 2).toFixed(4),
    withdrawable: Math.max(0, accountValue - margin).toFixed(4),
    time: Date.now(),
  };
}

function frontendOrder(o) {
  const orderType = o.trigger ? `${o.trigger.tpsl === "tp" ? "Take Profit" : "Stop"} ${o.trigger.isMarket ? "Market" : "Limit"}` : "Limit";
  return {
    coin: o.coin, side: o.b ? "B" : "A", limitPx: o.p, sz: o.s, oid: o.oid, timestamp: o.time, origSz: o.s,
    triggerCondition: o.trigger ? `Price ${o.b === (o.trigger.tpsl === "sl") ? "above" : "below"} ${o.trigger.triggerPx}` : "N/A",
    isTrigger: Boolean(o.trigger), triggerPx: o.trigger ? o.trigger.triggerPx : "0.0", children: [], isPositionTpsl: false,
    reduceOnly: o.r, orderType, tif: o.tif ?? null, cloid: null,
  };
}

function push(user, channel) {
  events.push({ user, channel });
}

/** Execute a fill against the account's position. */
function fill(a, o, px, crossed) {
  const m = BY_NAME.get(o.coin);
  const sz = +o.s;
  const signed = o.b ? sz : -sz;
  const pos = a.positions.get(o.coin) ?? { coin: o.coin, szi: 0, entryPx: px, lev: a.leverage.get(o.coin)?.lev ?? 20, cross: a.leverage.get(o.coin)?.cross ?? true };
  let closedPnl = 0;
  let take = signed;
  if (o.r) {
    // reduce-only: never flip or grow
    if (pos.szi === 0 || Math.sign(pos.szi) === Math.sign(signed)) return null;
    take = Math.sign(signed) * Math.min(Math.abs(signed), Math.abs(pos.szi));
  }
  const startPosition = pos.szi;
  if (pos.szi !== 0 && Math.sign(pos.szi) !== Math.sign(take)) {
    const closing = Math.min(Math.abs(take), Math.abs(pos.szi));
    closedPnl = closing * (px - pos.entryPx) * Math.sign(pos.szi);
    pos.szi += Math.sign(take) * closing;
    const rest = Math.abs(take) - closing;
    if (rest > 0) {
      pos.szi = Math.sign(take) * rest;
      pos.entryPx = px;
    }
  } else {
    pos.entryPx = pos.szi === 0 ? px : (pos.entryPx * Math.abs(pos.szi) + px * Math.abs(take)) / (Math.abs(pos.szi) + Math.abs(take));
    pos.szi += take;
  }
  const lv = a.leverage.get(o.coin);
  if (lv) Object.assign(pos, { lev: lv.lev, cross: lv.cross });
  a.positions.set(o.coin, pos);
  const ntl = Math.abs(take) * px;
  const builderFee = o.builder ? (ntl * o.builder.f) / 100000 : 0;
  const fee = ntl * (crossed ? FEES.taker : FEES.maker) + builderFee;
  a.usdc[m.dex] = (a.usdc[m.dex] ?? 0) + closedPnl - fee;
  const dir = startPosition === 0 || Math.sign(startPosition) === Math.sign(take) ? `Open ${take > 0 ? "Long" : "Short"}` : `Close ${startPosition > 0 ? "Long" : "Short"}`;
  const f = { coin: o.coin, px: str(px), sz: str(Math.abs(take)), side: o.b ? "B" : "A", time: Date.now(), startPosition: str(startPosition), dir, closedPnl: closedPnl.toFixed(6), hash: toHex(nextTid, { size: 32 }), oid: o.oid, crossed, fee: fee.toFixed(6), tid: nextTid++, feeToken: "USDC", ...(builderFee ? { builderFee: builderFee.toFixed(6) } : {}) };
  a.fills.unshift(f);
  if (pos.szi === 0) {
    a.positions.delete(o.coin);
    // position gone: cancel its reduce-only TP/SL
    a.orders = a.orders.filter((x) => !(x.coin === o.coin && x.r && x.trigger && x.active));
  }
  push(a.user, "userFills");
  return f;
}

function record(a, o, status) {
  a.history.unshift({ order: frontendOrder(o), status, statusTimestamp: Date.now() });
  push(a.user, "orderUpdates");
}

function crosses(o, px) {
  return o.b ? px <= +o.p : px >= +o.p;
}

function triggered(o, px) {
  const t = +o.trigger.triggerPx;
  // sell TP / buy SL trigger on the way up; sell SL / buy TP on the way down
  const up = o.b ? o.trigger.tpsl === "sl" : o.trigger.tpsl === "tp";
  return up ? px >= t : px <= t;
}

/** Run resting orders / triggers against current mids. */
function match() {
  for (const a of accounts.values()) {
    for (const o of [...a.orders]) {
      if (!o.active) continue;
      const px = mids[o.coin];
      if (o.trigger ? triggered(o, px) : crosses(o, px)) {
        a.orders = a.orders.filter((x) => x !== o);
        const fillPx = o.trigger ? (o.trigger.isMarket ? px : +o.p) : +o.p;
        const f = fill(a, o, fillPx, Boolean(o.trigger));
        record(a, o, f ? (o.trigger ? "triggered" : "filled") : "canceled");
        if (f) activateChildren(a, o);
      }
    }
  }
}

function activateChildren(a, parent) {
  for (const c of a.orders) if (c.parent === parent.oid) c.active = true;
}

// ---------------- Signatures ----------------
const ZERO = "0x0000000000000000000000000000000000000000";
const USER_TYPES = {
  approveAgent: ["HyperliquidTransaction:ApproveAgent", [["hyperliquidChain", "string"], ["agentAddress", "address"], ["agentName", "string"], ["nonce", "uint64"]]],
  approveBuilderFee: ["HyperliquidTransaction:ApproveBuilderFee", [["hyperliquidChain", "string"], ["maxFeeRate", "string"], ["builder", "address"], ["nonce", "uint64"]]],
  withdraw3: ["HyperliquidTransaction:Withdraw", [["hyperliquidChain", "string"], ["destination", "string"], ["amount", "string"], ["time", "uint64"]]],
  sendAsset: ["HyperliquidTransaction:SendAsset", [["hyperliquidChain", "string"], ["destination", "string"], ["sourceDex", "string"], ["destinationDex", "string"], ["token", "string"], ["amount", "string"], ["fromSubAccount", "string"], ["nonce", "uint64"]]],
};

async function recoverSigner(body) {
  const { action, nonce, signature, vaultAddress, expiresAfter } = body;
  const sig = { r: signature.r, s: signature.s, v: BigInt(signature.v) };
  const ut = USER_TYPES[action.type];
  if (ut) {
    const [primaryType, fields] = ut;
    const expectedChain = IS_TESTNET ? "Testnet" : "Mainnet";
    if (action.hyperliquidChain !== expectedChain) throw new Error(`Wrong hyperliquidChain ${action.hyperliquidChain}`);
    const message = Object.fromEntries(fields.map(([k]) => [k, action[k] ?? ""]));
    return {
      kind: "user",
      signer: (
        await recoverTypedDataAddress({
          domain: { name: "HyperliquidSignTransaction", version: "1", chainId: Number(action.signatureChainId), verifyingContract: ZERO },
          types: { [primaryType]: fields.map(([name, type]) => ({ name, type })) },
          primaryType,
          message,
          signature: sig,
        })
      ).toLowerCase(),
    };
  }
  const connectionId = createL1ActionHash({ action, nonce, vaultAddress, expiresAfter });
  return {
    kind: "l1",
    signer: (
      await recoverTypedDataAddress({
        domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: ZERO },
        types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] },
        primaryType: "Agent",
        message: { source: IS_TESTNET ? "b" : "a", connectionId },
        signature: sig,
      })
    ).toLowerCase(),
  };
}

const ok = (response = { type: "default" }) => ({ status: "ok", response });
const err = (msg) => ({ status: "err", response: msg });

async function exchange(body) {
  const { action } = body;
  let who;
  try {
    who = await recoverSigner(body);
  } catch (e) {
    return err(`Invalid signature: ${e.message}`);
  }
  // Resolve the user: user-signed actions are signed by the user; L1 actions by an approved agent.
  let user = who.signer;
  if (who.kind === "l1") {
    const owner = agentOwner.get(who.signer);
    if (!owner) return err(`User or API Wallet ${who.signer} does not exist.`);
    const ag = acct(owner).agents.find((x) => x.address === who.signer);
    if (!ag || (ag.validUntil && ag.validUntil < Date.now())) return err("Agent expired or revoked.");
    user = owner;
  }
  const a = acct(user);

  switch (action.type) {
    case "approveAgent": {
      if (a.usdc[""] <= 0) return err("Must deposit before performing actions.");
      const [name, , until] = (action.agentName ?? "").split(" ");
      // a new agent under the same name replaces the old one
      for (const old of a.agents.filter((x) => x.name === name)) agentOwner.delete(old.address);
      a.agents = a.agents.filter((x) => x.name !== name);
      const ag = { address: action.agentAddress.toLowerCase(), name, validUntil: until ? Number(until) : null };
      a.agents.push(ag);
      agentOwner.set(ag.address, user);
      return ok();
    }
    case "approveBuilderFee": {
      const pct = Number(String(action.maxFeeRate).replace("%", ""));
      if (!(pct >= 0) || pct > 0.1) return err("Invalid max fee rate");
      if (+clearinghouse(acct(action.builder), "").marginSummary.accountValue < MIN_BUILDER_VALUE) return err("Builder has insufficient balance to be approved.");
      a.builders.set(action.builder.toLowerCase(), Math.round(pct * 1000));
      return ok();
    }
    case "withdraw3": {
      const amt = Number(action.amount);
      const w = +clearinghouse(a, "").withdrawable;
      if (!(amt > 1) || amt > w) return err("Insufficient balance for withdrawal");
      a.usdc[""] -= amt;
      a.withdrawals.push({ amount: amt, destination: action.destination, time: Date.now() });
      a.ledger.push({ time: Date.now(), hash: keccak256(toHex(`w${Date.now()}${Math.random()}`)), delta: { type: "withdraw", usdc: String(amt), nonce: Date.now(), fee: "1.0" } });
      return ok();
    }
    case "agentSendAsset":
    case "sendAsset": {
      if (action.type === "agentSendAsset" && action.destination.toLowerCase() !== user) return err("Destination must be the same user");
      const amt = Number(action.amount);
      if (amt > +clearinghouse(a, action.sourceDex).withdrawable) return err("Insufficient balance");
      a.usdc[action.sourceDex] -= amt;
      a.usdc[action.destinationDex] = (a.usdc[action.destinationDex] ?? 0) + amt;
      return ok();
    }
    case "updateLeverage": {
      const m = ASSET.get(action.asset);
      if (!m) return err("Invalid asset");
      if (action.leverage > m.maxLev) return err(`Leverage exceeds max ${m.maxLev}x`);
      if (action.isCross && m.dex) return err("Cross margin is not supported for this asset");
      a.leverage.set(m.name, { lev: action.leverage, cross: action.isCross });
      return ok();
    }
    case "cancel": {
      const statuses = action.cancels.map(({ o }) => {
        const ord = a.orders.find((x) => x.oid === o);
        if (!ord) return { error: "Order was never placed, already canceled, or filled." };
        a.orders = a.orders.filter((x) => x !== ord);
        record(a, ord, "canceled");
        return "success";
      });
      return ok({ type: "cancel", data: { statuses } });
    }
    case "order": {
      const b = action.builder;
      // Mock check of the app's fee policy (Hyperliquid itself accepts orders without a builder):
      // only the builder's own orders, or any while the builder can't be approved, skip the fee.
      const builderUnfunded = +clearinghouse(acct(BUILDER), "").marginSummary.accountValue < MIN_BUILDER_VALUE;
      if (!b && a.user !== BUILDER && !builderUnfunded) return err("Builder fee is required by this deployment (mock check)");
      const approved = b && a.builders.get(b.b.toLowerCase());
      if (b && (approved == null || approved < b.f)) return err("Builder fee has not been approved.");
      const statuses = [];
      let parent = null;
      for (const [i, w] of action.orders.entries()) {
        const m = ASSET.get(w.a);
        if (!m) {
          statuses.push({ error: "Invalid asset" });
          continue;
        }
        const o = { oid: nextOid++, coin: m.name, b: w.b, p: w.p, s: w.s, r: w.r, time: Date.now(), builder: b, active: true };
        if (+w.s * mids[m.name] < 10 && !w.r) {
          statuses.push({ error: "Order must have minimum value of $10." });
          continue;
        }
        if ("trigger" in w.t) {
          o.trigger = w.t.trigger;
          if (i > 0 && action.grouping === "normalTpsl") {
            o.parent = parent?.oid;
            o.active = Boolean(parent?.filled);
          }
          a.orders.push(o);
          record(a, o, "open");
          statuses.push(i === 0 ? "waitingForTrigger" : "waitingForFill");
          if (i === 0) parent = o;
          continue;
        }
        o.tif = w.t.limit.tif;
        const px = mids[m.name];
        const marketable = crosses(o, px);
        if (o.tif === "Alo" && marketable) {
          statuses.push({ error: "Post only order would have immediately matched" });
          continue;
        }
        if (marketable) {
          // margin check for opening fills
          if (!o.r) {
            const lev = a.leverage.get(m.name)?.lev ?? 20;
            const need = (+o.s * px) / lev;
            if (need > +clearinghouse(a, m.dex).withdrawable) {
              statuses.push({ error: "Insufficient margin to place order." });
              continue;
            }
          }
          const f = fill(a, o, px, true);
          record(a, o, f ? "filled" : "canceled");
          statuses.push(f ? { filled: { totalSz: f.sz, avgPx: f.px, oid: o.oid } } : { error: "Reduce only order would increase position." });
          if (i === 0) parent = { ...o, filled: Boolean(f) };
        } else if (o.tif === "Ioc") {
          record(a, o, "canceled");
          statuses.push({ error: "Order could not immediately match against any resting orders." });
        } else {
          a.orders.push(o);
          record(a, o, "open");
          statuses.push({ resting: { oid: o.oid } });
          if (i === 0) parent = o;
        }
      }
      // children of an immediately-filled entry become live
      if (parent?.filled) for (const c of a.orders) if (c.parent === parent.oid) c.active = true;
      match();
      return ok({ type: "order", data: { statuses } });
    }
    default:
      return err(`Unsupported action in mock: ${action.type}`);
  }
}

// ---------------- Info ----------------
function info(b) {
  switch (b.type) {
    case "metaAndAssetCtxs":
      return metaAndCtxs(b.dex === "xyz" ? XYZ : MAIN);
    case "meta":
      return metaAndCtxs(b.dex === "xyz" ? XYZ : MAIN)[0];
    case "spotMeta":
      return { tokens: [{ name: "USDC", szDecimals: 8, weiDecimals: 8, index: 0, tokenId: "0x6d1e7cde53ba9467b783cb7c530ce054", isCanonical: true, evmContract: null, fullName: null }], universe: [] };
    case "perpDexs":
      return [null, { name: "xyz", fullName: "XYZ", deployer: "0x0000000000000000000000000000000000000001" }];
    case "allMids":
      return Object.fromEntries(Object.entries(mids).filter(([k]) => (b.dex === "xyz" ? k.startsWith("xyz:") : !k.includes(":"))).map(([k, v]) => [k, str(v)]));
    case "l2Book":
      return book(b.coin);
    case "candleSnapshot":
      return candles(b.req.coin, b.req.interval, b.req.startTime, b.req.endTime ?? Date.now());
    case "clearinghouseState":
      return clearinghouse(acct(b.user), b.dex ?? "");
    case "spotClearinghouseState":
      return { balances: [] };
    case "frontendOpenOrders":
    case "openOrders":
      return acct(b.user).orders.filter((o) => BY_NAME.get(o.coin).dex === (b.dex ?? "")).map(frontendOrder);
    case "historicalOrders":
      return acct(b.user).history;
    case "userFills":
      return acct(b.user).fills;
    case "userFillsByTime":
      // oldest first, like Hyperliquid
      return acct(b.user).fills.filter((f) => f.time >= (b.startTime ?? 0) && (b.endTime == null || f.time <= b.endTime)).slice().reverse();
    case "portfolio": {
      const v = +clearinghouse(acct(b.user), "").marginSummary.accountValue;
      return [["perpMonth", { accountValueHistory: [[Date.now() - 864e5, String(v)]], pnlHistory: [], vlm: "0" }]];
    }
    case "userFunding":
      return [];
    case "userNonFundingLedgerUpdates":
      return acct(b.user).ledger.filter((l) => l.time >= (b.startTime ?? 0));
    case "extraAgents":
      return acct(b.user).agents.map((x) => ({ address: x.address, name: x.name, validUntil: x.validUntil }));
    case "maxBuilderFee":
      return acct(b.user).builders.get(b.builder.toLowerCase()) ?? 0;
    case "userAbstraction":
      return "default";
    default:
      return undefined;
  }
}

// ---------------- Arbitrum JSON-RPC (deposits) ----------------
const txs = new Map();
let block = 1000;
const ERC20 = [{ type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }];
const arbBalances = new Map(); // user -> USDC units (6 decimals); every wallet starts with 1,000 test USDC

function rpc({ method, params = [] }) {
  switch (method) {
    case "eth_chainId":
      return toHex(ARB_CHAIN_ID);
    case "eth_blockNumber":
      return toHex(block++);
    case "eth_call": {
      const { data } = params[0];
      if (data?.startsWith("0x70a08231")) {
        const who = `0x${data.slice(34, 74)}`.toLowerCase();
        return toHex(arbBalances.get(who) ?? 1_000_000_000n, { size: 32 });
      }
      return "0x";
    }
    case "eth_sendTransaction": {
      // Test wallets route their sends here (the fake injected provider).
      const tx = params[0];
      const hash = keccak256(toHex(`${tx.from}${tx.data}${Date.now()}${Math.random()}`));
      if (tx.to?.toLowerCase() === USDC) {
        const { args } = decodeFunctionData({ abi: ERC20, data: tx.data });
        const [to, amount] = args;
        const from = tx.from.toLowerCase();
        arbBalances.set(from, (arbBalances.get(from) ?? 1_000_000_000n) - amount);
        // Bridge2 credits deposits ≥ 5 USDC shortly after the transfer lands.
        if (to.toLowerCase() === BRIDGE && amount >= 5_000_000n) setTimeout(() => credit(from, Number(amount) / 1e6), 1500);
      }
      txs.set(hash, { ...tx, blockNumber: block++ });
      return hash;
    }
    case "eth_getTransactionReceipt": {
      const tx = txs.get(params[0]);
      if (!tx) return null;
      return {
        transactionHash: params[0], transactionIndex: "0x0", blockHash: keccak256(toHex(tx.blockNumber)), blockNumber: toHex(tx.blockNumber),
        from: tx.from, to: tx.to, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1", contractAddress: null,
        logs: [], logsBloom: `0x${"0".repeat(512)}`, status: "0x1", type: "0x2",
      };
    }
    case "eth_getBlockByNumber":
      return { number: toHex(block), hash: keccak256(toHex(block)), timestamp: toHex(Math.floor(Date.now() / 1000)), transactions: [], baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", parentHash: keccak256(toHex(block - 1)) };
    default:
      throw new Error(`rpc method not mocked: ${method}`);
  }
}

function credit(user, amount) {
  const a = acct(user);
  a.usdc[""] += amount;
  a.ledger.push({ time: Date.now(), hash: keccak256(toHex(`d${Date.now()}${Math.random()}`)), delta: { type: "deposit", usdc: String(amount) } });
  push(a.user, "userFills");
}

// ---------------- HTTP ----------------
const readBody = (req) => new Promise((r) => {
  let s = "";
  req.on("data", (c) => (s += c));
  req.on("end", () => r(s ? JSON.parse(s) : {}));
});
const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  try {
    if (req.method === "GET" && req.url === "/__mock/state") {
      return send(res, 200, Object.fromEntries([...accounts.entries()].map(([u, a]) => [u, { usdc: a.usdc, positions: [...a.positions.values()], orders: a.orders, fills: a.fills, agents: a.agents, builders: Object.fromEntries(a.builders), withdrawals: a.withdrawals }])));
    }
    const body = await readBody(req);
    if (req.url === "/info") {
      const out = info(body);
      return out === undefined ? res.writeHead(422).end(`unknown type ${body.type}`) : send(res, 200, out);
    }
    if (req.url === "/exchange") return send(res, 200, await exchange(body));
    if (req.url === "/rpc") {
      const one = (r) => {
        try {
          return { jsonrpc: "2.0", id: r.id, result: rpc(r) };
        } catch (e) {
          return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: e.message } };
        }
      };
      return send(res, 200, Array.isArray(body) ? body.map(one) : one(body));
    }
    if (req.url === "/__mock/price") {
      mids[body.coin] = body.px;
      pinned.add(body.coin);
      match();
      return send(res, 200, { ok: true });
    }
    if (req.url === "/__mock/usdc") {
      acct(body.user).usdc[""] = Number(body.amount);
      return send(res, 200, { ok: true });
    }
    if (req.url === "/__mock/deposit") {
      credit(body.user, body.amount);
      return send(res, 200, { ok: true });
    }
    res.writeHead(404).end();
  } catch (e) {
    send(res, 500, { error: String(e?.message ?? e) });
  }
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server, path: "/ws" });
const sockets = new Set();
wss.on("connection", (ws) => {
  const subs = [];
  sockets.add({ ws, subs });
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
  ws.on("close", () => {
    for (const s of sockets) if (s.ws === ws) sockets.delete(s);
  });
});

setInterval(() => {
  for (const k in mids) if (!pinned.has(k)) mids[k] *= 1 + (rnd() - 0.5) * 0.0016;
  match();
  const evs = events.splice(0);
  for (const { ws, subs } of sockets) {
    if (ws.readyState !== 1) continue;
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
      } else if ((s.type === "orderUpdates" || s.type === "userFills") && evs.some((e) => e.user === s.user.toLowerCase() && e.channel === s.type)) {
        ws.send(JSON.stringify({ channel: s.type, data: s.type === "userFills" ? { user: s.user, fills: [] } : [] }));
      }
    }
  }
}, 1200);

server.listen(PORT, () => console.log(`mock Hyperliquid (${IS_TESTNET ? "testnet" : "mainnet"}) on http://localhost:${PORT} (info, exchange, ws, rpc)`));
