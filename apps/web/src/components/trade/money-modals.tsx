"use client";

import { validateWithdraw, WITHDRAW_FEE_USDC } from "@swellfi/hl";
import { fUsd } from "@swellfi/ui";
import dynamic from "next/dynamic";
import { useState } from "react";
import { BRAND, HL } from "@/lib/env";
import { useHlAccount } from "@/lib/trading/account";
import { ARB, errMsg, useTrading } from "@/lib/trading/use-trading";
import { toast, useUi } from "@/lib/ui-store";
import { Modal } from "../modal";

// The deposit flow (token registry, Relay) is only loaded once the modal opens.
const DepositBody = dynamic(() => import("./deposit-body"), { ssr: false, loading: () => <p className="mut">Loading…</p> });

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
