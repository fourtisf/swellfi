"use client";

import { fromUsdcUnits, MIN_DEPOSIT_USDC, validateDeposit, validateWithdraw, WITHDRAW_FEE_USDC } from "@tideline/hl";
import { fUsd } from "@tideline/ui";
import { useEffect, useState } from "react";
import { BRAND, HL } from "@/lib/env";
import { useHlAccount } from "@/lib/trading/account";
import { ARB, creditedBalance, errMsg, usdcBalance, useTrading, waitForCredit } from "@/lib/trading/use-trading";
import { toast, useUi } from "@/lib/ui-store";
import { Modal } from "../modal";

type DepStage = "idle" | "sign" | "mining" | "crediting" | "done" | "slow";

function DepositBody() {
  const acct = useHlAccount();
  const t = useTrading(acct);
  const close = useUi((u) => u.closeModal);
  const [bal, setBal] = useState<bigint | null>(null);
  const [amt, setAmt] = useState("");
  const [stage, setStage] = useState<DepStage>("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!acct.user) return;
    usdcBalance(acct.user)
      .then(setBal)
      .catch(() => setBal(null));
  }, [acct.user, stage]);

  const invalid = bal == null ? null : validateDeposit(amt, bal);
  const busy = stage === "sign" || stage === "mining" || stage === "crediting";

  const go = async () => {
    setErr("");
    if (invalid) return setErr(invalid);
    if (HL.network === "mainnet" && !confirm(`Deposit ${amt} USDC from Arbitrum to Hyperliquid MAINNET?`)) return;
    try {
      setStage("sign");
      // Snapshot the balance before the transfer is sent so the credit can be detected.
      const before = await creditedBalance(acct.user!).catch(() => 0);
      await t.deposit(amt, (h) => {
        setTx(h);
        setStage("mining");
      });
      setStage("crediting");
      const ok = await waitForCredit(acct.user!, before);
      setStage(ok ? "done" : "slow");
      acct.refresh();
      if (ok) toast(`${amt} USDC credited to your ${BRAND} account`);
    } catch (e) {
      setStage("idle");
      setErr(errMsg(e));
    }
  };

  const step = (label: string, on: boolean, ok: boolean) => (
    <div className={ok ? "ok" : on ? "on" : ""}>
      <span>{ok ? "✓" : on ? "●" : "○"}</span>
      {label}
    </div>
  );
  const order = ["sign", "mining", "crediting", "done"];
  const at = order.indexOf(stage === "slow" ? "crediting" : stage);

  return (
    <>
      <h3>Deposit USDC</h3>
      <p className="mut" style={{ margin: "0 0 14px" }}>
        From {ARB.chainName} into your own Hyperliquid account. {BRAND} never holds your funds.
      </p>
      <div className="field">
        <label>
          <span>Amount</span>
          <span>On {ARB.chainName}: {bal == null ? "—" : `${fromUsdcUnits(bal).toFixed(2)} USDC`}</span>
        </label>
        <div className="amtrow">
          <div className="wrap" style={{ flex: 1 }}>
            <input className="input" inputMode="decimal" placeholder={`Minimum ${MIN_DEPOSIT_USDC}`} value={amt} disabled={busy} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            <span>USDC</span>
          </div>
          <button className="btn btn-ghost" style={{ height: 42 }} disabled={busy || !bal} onClick={() => bal && setAmt(fromUsdcUnits(bal).toFixed(2))}>
            Max
          </button>
        </div>
      </div>
      <div className="warnbox">Deposits below {MIN_DEPOSIT_USDC} USDC are lost by the bridge. Only send USDC on {ARB.chainName}.</div>
      {stage !== "idle" && (
        <div className="steps-v">
          {step("Confirm the transfer in your wallet", at === 0, at > 0)}
          {step("Transfer confirming on Arbitrum", at === 1, at > 1)}
          {step(stage === "slow" ? "Still waiting for Hyperliquid to credit it. It will appear shortly." : "Waiting for Hyperliquid to credit it (about a minute)", at === 2, at > 2)}
          {tx && (
            <a href={`${ARB.explorer}/tx/${tx}`} target="_blank" rel="noreferrer" className="mut" style={{ textDecoration: "underline", fontSize: 12.5 }}>
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
        <button className="btn btn-brand submit" disabled={busy || !amt} onClick={go}>
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

function WithdrawBody() {
  const acct = useHlAccount();
  const t = useTrading(acct);
  const close = useUi((u) => u.closeModal);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const avail = acct.withdrawableByDex[""] ?? 0;
  const go = async () => {
    setErr("");
    const v = validateWithdraw(amt, avail);
    if (v) return setErr(v);
    if (HL.network === "mainnet" && !confirm(`Withdraw ${amt} USDC from Hyperliquid MAINNET to ${acct.user}?`)) return;
    setBusy(true);
    try {
      await t.withdraw(amt);
      close();
      toast(`Withdrawal of ${amt} USDC sent. It arrives on ${ARB.chainName} in a few minutes.`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>Withdraw USDC</h3>
      <p className="mut" style={{ margin: "0 0 14px" }}>
        Sent to your wallet on {ARB.chainName}. Withdrawals are signed by your own wallet; {BRAND}&apos;s trading key can&apos;t move funds out.
      </p>
      <div className="field">
        <label>
          <span>Amount</span>
          <span>Withdrawable: {fUsd(avail)}</span>
        </label>
        <div className="amtrow">
          <div className="wrap" style={{ flex: 1 }}>
            <input className="input" inputMode="decimal" placeholder="0.00" value={amt} disabled={busy} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            <span>USDC</span>
          </div>
          <button className="btn btn-ghost" style={{ height: 42 }} disabled={busy || avail <= 0} onClick={() => setAmt((Math.floor(avail * 100) / 100).toFixed(2))}>
            Max
          </button>
        </div>
      </div>
      <div className="summary">
        <div>
          <span>Destination</span>
          <span>{acct.user ? `${acct.user.slice(0, 6)}…${acct.user.slice(-4)}` : "—"}</span>
        </div>
        <div>
          <span>Hyperliquid fee</span>
          <span>{WITHDRAW_FEE_USDC} USDC</span>
        </div>
        <div>
          <span>You receive</span>
          <span>{+amt > WITHDRAW_FEE_USDC ? `${(+amt - WITHDRAW_FEE_USDC).toFixed(2)} USDC` : "—"}</span>
        </div>
      </div>
      {acct.positions.some((p) => p.dex) && <div className="warnbox">Funds on HIP-3 markets aren&apos;t included until those positions are closed.</div>}
      {err && <p className="err">{err}</p>}
      <button className="btn btn-brand submit" disabled={busy || !amt} onClick={go}>
        {busy ? "Confirm in your wallet…" : "Withdraw"}
      </button>
    </>
  );
}

export function MoneyModals() {
  return (
    <>
      <Modal name="deposit" className="glass glow-border">
        <DepositBody />
      </Modal>
      <Modal name="withdraw" className="glass glow-border">
        <WithdrawBody />
      </Modal>
    </>
  );
}
