"use client";

import { CoinIcon } from "@swellfi/ui";
import { MIN_DEPOSIT_USDC, validateDeposit } from "@swellfi/hl";
import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { BRAND, HL } from "@/lib/env";
import { useSession } from "@/lib/session";
import { useHlAccount } from "@/lib/trading/account";
import { DEPOSIT_CHAINS, isDirectBridge, NATIVE } from "@/lib/trading/chains";
import { networkLogo } from "@/lib/trading/networks";
import type { DepositQuote } from "@/lib/trading/relay";
import { ARB, creditedBalance, errMsg, usdcBalance, useTrading, waitForCredit } from "@/lib/trading/use-trading";
import { toast, useUi } from "@/lib/ui-store";

// Loaded only when the Deposit modal opens (see money-modals.tsx), so the token registry and
// deposit code stay out of the bundle every page loads.

type DepStage = "idle" | "sign" | "mining" | "relaying" | "crediting" | "done" | "slow";

// The Relay SDK is only needed once someone picks another network or token.
const relay = () => import("@/lib/trading/relay");
const relayMsg = async (e: unknown) => (await relay()).relayErr(e);

// Native-coin "Max" leaves this much for gas on the origin chain.
const GAS_RESERVE: Record<number, string> = { 1: "0.003", 56: "0.003", 137: "0.5", 43114: "0.02" };
const gasReserve = (chainId: number, decimals: number) => parseUnits(GAS_RESERVE[chainId] ?? "0.0005", decimals);

export default function DepositBody() {
  const acct = useHlAccount();
  const t = useTrading(acct);
  const s = useSession();
  const close = useUi((u) => u.closeModal);
  // Other networks and tokens go through Relay, which only exists on mainnet.
  const multi = HL.network === "mainnet";
  const [ci, setCi] = useState(0);
  const [ti, setTi] = useState(0);
  const src = DEPOSIT_CHAINS[ci]!;
  const token = multi ? src.tokens[ti]! : { symbol: "USDC", address: ARB.usdc, decimals: 6 };
  const direct = !multi || isDirectBridge(src.chain.id, token);
  const [bal, setBal] = useState<bigint | null>(null);
  const [amt, setAmt] = useState("");
  const [stage, setStage] = useState<DepStage>("idle");
  const [tx, setTx] = useState<{ hash: string; url: string } | null>(null);
  const [err, setErr] = useState("");
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const busy = stage === "sign" || stage === "mining" || stage === "relaying" || stage === "crediting";

  useEffect(() => {
    if (!acct.user) return;
    setBal(null);
    let alive = true;
    (direct ? usdcBalance(acct.user) : relay().then((r) => r.tokenBalance(src, token, acct.user!)))
      .then((b) => alive && setBal(b))
      .catch(() => alive && setBal(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acct.user, stage, ci, ti, direct]);

  // Live Relay quote for the typed amount (debounced).
  useEffect(() => {
    setQuote(null);
    if (busy) return;
    setErr("");
    if (direct || !acct.user || !(Number(amt) > 0)) return;
    let alive = true;
    setQuoting(true);
    const h = setTimeout(() => {
      relay()
        .then((r) => r.quoteDeposit(src, token, amt, acct.user!))
        .then((q) => alive && (setQuote(q), setErr("")))
        .catch(async (e) => {
          const m = await relayMsg(e);
          if (alive) setErr(m);
        })
        .finally(() => alive && setQuoting(false));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(h);
      setQuoting(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, ci, ti, direct, acct.user]);

  const units = (() => {
    try {
      return amt ? parseUnits(amt, token.decimals) : 0n;
    } catch {
      return null;
    }
  })();
  const invalid = direct
    ? bal == null
      ? null
      : validateDeposit(amt, bal)
    : units == null
      ? "Enter a valid amount"
      : bal != null && units > bal
        ? `You have ${formatUnits(bal, token.decimals)} ${token.symbol} on ${src.name}`
        : null;

  const max = () => {
    if (!bal) return;
    const v = token.address === NATIVE ? bal - gasReserve(src.chain.id, token.decimals) : bal;
    if (v <= 0n) return setErr(`Keep some ${token.symbol} for gas: your balance is too low to deposit it`);
    // Truncate (never round up past the balance): 2 decimals for stablecoins, 6 for native coins.
    const keep = token.address === NATIVE ? 6 : 2;
    const f = formatUnits(v, token.decimals);
    const [w, frac = ""] = f.split(".");
    setAmt(keep && frac ? `${w}.${frac.slice(0, keep)}`.replace(/\.?0+$/, "") || "0" : w!);
  };

  const goDirect = async () => {
    if (HL.network === "mainnet" && !confirm(`Deposit ${amt} USDC from Arbitrum to Hyperliquid MAINNET?`)) return;
    setStage("sign");
    // Snapshot the balance before the transfer is sent so the credit can be detected.
    const before = await creditedBalance(acct.user!).catch(() => 0);
    await t.deposit(amt, (h) => {
      setTx({ hash: h, url: `${ARB.explorer}/tx/${h}` });
      setStage("mining");
    });
    setStage("crediting");
    return waitForCredit(acct.user!, before);
  };

  const goRelay = async () => {
    // Re-quote right before signing so the confirmed amount is current.
    setStage("sign");
    const { quoteDeposit, executeDeposit, isRelayTimeout } = await relay();
    const q = await quoteDeposit(src, token, amt, acct.user!);
    setQuote(q);
    const msg = `Deposit ${amt} ${token.symbol} from ${src.name} to Hyperliquid MAINNET via Relay?\n\nYou'll receive about ${q.receiveUsdc.toFixed(2)} USDC in your own Hyperliquid account${q.feesUsd != null ? ` (fees about $${q.feesUsd.toFixed(2)})` : ""}.`;
    if (!confirm(msg)) {
      setStage("idle");
      return null;
    }
    const before = await creditedBalance(acct.user!).catch(() => 0);
    const wallet = await s.getMasterWallet(src.chain.id);
    const explorer = src.chain.blockExplorers?.default.url;
    let sent = false;
    try {
      await executeDeposit(q, wallet, (st, hash) => {
        if (hash) sent = true;
        if (hash && explorer) setTx({ hash, url: `${explorer}/tx/${hash}` });
        setStage(st === "sign" ? "sign" : st === "confirming" ? "mining" : "relaying");
      });
    } catch (e) {
      // Relay only stopped watching a deposit already on its way: keep waiting for the credit.
      if (!sent || !isRelayTimeout(e)) throw e;
    }
    setStage("crediting");
    return waitForCredit(acct.user!, before);
  };

  const go = async () => {
    setErr("");
    if (direct && bal == null) return setErr("Still loading your balance. Try again in a moment.");
    if (invalid) return setErr(invalid);
    if (!direct && !(Number(amt) > 0)) return setErr("Enter an amount");
    try {
      const ok = await (direct ? goDirect() : goRelay());
      if (ok == null) return;
      setStage(ok ? "done" : "slow");
      acct.refresh();
      if (ok) toast(`Deposit credited to your ${BRAND} account`);
    } catch (e) {
      setStage("idle");
      setErr(direct ? errMsg(e) : await relayMsg(e));
    }
  };

  const step = (label: string, on: boolean, ok: boolean) => (
    <div className={ok ? "ok" : on ? "on" : ""}>
      <span>{ok ? "✓" : on ? "●" : "○"}</span>
      {label}
    </div>
  );
  const order = direct ? ["sign", "mining", "crediting", "done"] : ["sign", "mining", "relaying", "crediting", "done"];
  const at = order.indexOf(stage === "slow" ? "crediting" : stage);
  const stable = token.address !== NATIVE;
  const balText = bal == null ? "—" : `${stable ? (+formatUnits(bal, token.decimals)).toFixed(2) : (+(+formatUnits(bal, token.decimals)).toFixed(6)).toString()} ${token.symbol}`;

  return (
    <>
      <h3>{multi ? "Deposit" : "Deposit USDC"}</h3>
      <p className="mut" style={{ margin: "0 0 14px" }}>
        {multi ? "Into" : `From ${ARB.chainName} into`} your own Hyperliquid account. {BRAND} never holds your funds.
      </p>
      {multi && (
        <>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>
              <span>Network</span>
            </label>
            <div className="netgrid">
              {DEPOSIT_CHAINS.map((d, i) => (
                <button
                  key={d.chain.id}
                  className={`netbtn net${i === ci ? " on" : ""}`}
                  title={d.name}
                  disabled={busy}
                  onClick={() => {
                    setCi(i);
                    setTi(0);
                    setAmt("");
                    setErr("");
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={networkLogo(d.chain.id)} alt="" />
                  <span>{d.short}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>
              <span>Token</span>
            </label>
            <div className="tokrow">
              {src.tokens.map((tk, i) => (
                <button
                  key={tk.symbol}
                  className={`netbtn${i === ti ? " on" : ""}`}
                  disabled={busy}
                  onClick={() => {
                    setTi(i);
                    setAmt("");
                    setErr("");
                  }}
                >
                  <CoinIcon name={tk.symbol} size={22} />
                  <span>{tk.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="field">
        <label>
          <span>Amount</span>
          <span>
            On {multi ? src.name : ARB.chainName}: {balText}
          </span>
        </label>
        <div className="amtrow">
          <div className="wrap" style={{ flex: 1 }}>
            <input className="input" inputMode="decimal" placeholder={direct ? `Minimum ${MIN_DEPOSIT_USDC}` : "0.00"} value={amt} disabled={busy} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            <span>{token.symbol}</span>
          </div>
          <button className="btn btn-ghost" style={{ height: 42 }} disabled={busy || !bal} onClick={max}>
            Max
          </button>
        </div>
      </div>
      {direct ? (
        <div className="warnbox">
          Deposits below {MIN_DEPOSIT_USDC} USDC are lost by the bridge. Only send USDC on {ARB.chainName}.
        </div>
      ) : (
        <div className="quotebox">
          <div>
            <span>You receive</span>
            <b>{quote ? `≈ ${quote.receiveUsdc.toFixed(2)} USDC` : quoting ? "Getting quote…" : "—"}</b>
          </div>
          <div>
            <span>Fees</span>
            <span>{quote?.feesUsd != null ? `≈ $${quote.feesUsd.toFixed(2)}` : "—"}</span>
          </div>
          <div>
            <span>Time</span>
            <span>{quote?.seconds != null ? (quote.seconds < 60 ? `~${Math.max(1, Math.round(quote.seconds))}s` : `~${Math.round(quote.seconds / 60)} min`) : "—"}</span>
          </div>
          <p>
            Converted to USDC and delivered to your Hyperliquid account by <a href="https://relay.link" target="_blank" rel="noreferrer">Relay</a>. Keep a little {src.chain.nativeCurrency.symbol} on {src.name} for gas.
          </p>
        </div>
      )}
      {stage !== "idle" && (
        <div className="steps-v">
          {step("Confirm in your wallet", at === 0, at > 0)}
          {step(`Transaction confirming on ${multi ? src.name : "Arbitrum"}`, at === 1, at > 1)}
          {!direct && step("Relay delivering USDC to Hyperliquid", at === 2, at > 2)}
          {step(stage === "slow" ? "Still waiting for Hyperliquid to credit it. It will appear shortly." : "Waiting for Hyperliquid to credit it", at === order.length - 2, at > order.length - 2)}
          {tx && (
            <a href={tx.url} target="_blank" rel="noreferrer" className="mut" style={{ textDecoration: "underline", fontSize: 12.5 }}>
              View transaction
            </a>
          )}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      {stage === "done" || stage === "slow" ? (
        <button className="btn btn-brand submit" onClick={close}>
          Done
        </button>
      ) : (
        <button className="btn btn-brand submit" disabled={busy || !amt || (!direct && (!quote || quoting))} onClick={go}>
          {busy ? "Depositing…" : "Deposit"}
        </button>
      )}
      {HL.network === "testnet" && (
        <p className="dim" style={{ fontSize: 12, margin: "12px 0 0" }}>
          Testnet: this uses test USDC on Arbitrum Sepolia. You can also claim mock USDC from the Hyperliquid testnet faucet.
        </p>
      )}
    </>
  );
}

