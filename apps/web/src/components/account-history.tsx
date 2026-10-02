"use client";

import { useQuery } from "@tanstack/react-query";
import { BRIDGE } from "@swellfi/hl";
import { Icon } from "@swellfi/ui";
import { HL } from "@/lib/env";
import { hlInfo } from "@/lib/trading/account";

type Ledger = Awaited<ReturnType<typeof hlInfo.userNonFundingLedgerUpdates>>[number];

interface Row {
  key: string;
  time: number;
  label: string;
  sub: string;
  /** Signed USDC (or token) amount; null when the movement is internal. */
  amount: number | null;
  unit: string;
  fee?: number;
  hash: string;
  pending?: boolean;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const dexName = (d: string) => (d === "" ? "Perps" : d === "spot" ? "Spot" : d.toUpperCase());

function describe(l: Ledger, user: string, chain: string): Row | null {
  const d = l.delta as Record<string, unknown> & { type: string };
  const base = { key: `${l.hash}:${d.type}:${l.time}`, time: l.time, hash: l.hash, unit: "USDC" };
  const incoming = typeof d.destination === "string" && d.destination.toLowerCase() === user;
  switch (d.type) {
    case "deposit":
      return { ...base, label: "Deposit", sub: `From ${chain}`, amount: num(d.usdc) };
    case "withdraw":
      // Hyperliquid has sent it; it lands on Arbitrum a few minutes later.
      return { ...base, label: "Withdrawal", sub: `To ${chain}`, amount: -(num(d.usdc) ?? 0), fee: num(d.fee) ?? undefined, pending: Date.now() - l.time < 15 * 60_000 };
    case "internalTransfer":
      return { ...base, label: incoming ? "Received" : "Sent", sub: incoming ? `From ${short(String(d.user))}` : `To ${short(String(d.destination))}`, amount: (incoming ? 1 : -1) * (num(d.usdc) ?? 0), fee: num(d.fee) ?? undefined };
    case "send": {
      const own = String(d.user).toLowerCase() === user && incoming;
      if (own) return { ...base, label: "Moved between markets", sub: `${dexName(String(d.sourceDex))} → ${dexName(String(d.destinationDex))}`, amount: null, unit: String(d.token ?? "USDC") };
      return { ...base, label: incoming ? "Received" : "Sent", sub: incoming ? `From ${short(String(d.user))}` : `To ${short(String(d.destination))}`, amount: (incoming ? 1 : -1) * (num(d.amount) ?? 0), unit: String(d.token ?? "USDC") };
    }
    case "spotTransfer":
      return { ...base, label: incoming ? "Received" : "Sent", sub: incoming ? `From ${short(String(d.user))}` : `To ${short(String(d.destination))}`, amount: (incoming ? 1 : -1) * (num(d.amount) ?? 0), unit: String(d.token ?? "") };
    case "accountClassTransfer":
      return { ...base, label: "Moved between markets", sub: d.toPerp ? "Spot → Perps" : "Perps → Spot", amount: null };
    case "vaultDeposit":
      return { ...base, label: "Vault deposit", sub: short(String(d.vault ?? "")), amount: -(num(d.usdc) ?? 0) };
    case "vaultWithdraw":
      return { ...base, label: "Vault withdrawal", sub: short(String(d.vault ?? "")), amount: num(d.netWithdrawnUsd ?? d.usdc) };
    case "rewardsClaim":
      return { ...base, label: "Rewards claimed", sub: "Hyperliquid", amount: num(d.amount), unit: String(d.token ?? "") };
    case "liquidation":
      return { ...base, label: "Liquidation", sub: "Positions closed by Hyperliquid", amount: null };
    default:
      return null;
  }
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

/** Deposits, withdrawals and transfers of the signed-in user's own Hyperliquid account (last 90 days). */
export function AccountHistory({ user }: { user: string }) {
  const addr = user.toLowerCase() as `0x${string}`;
  const chain = BRIDGE[HL.network].chainName;
  const explorer = HL.network === "mainnet" ? "https://app.hyperliquid.xyz/explorer" : "https://app.hyperliquid-testnet.xyz/explorer";
  const q = useQuery({
    queryKey: ["ledger", addr],
    refetchInterval: 20_000,
    queryFn: () => hlInfo.userNonFundingLedgerUpdates({ user: addr, startTime: Date.now() - 90 * 864e5 }),
  });
  const rows = (q.data ?? [])
    .map((l) => describe(l, addr, chain))
    .filter((r): r is Row => r != null)
    .sort((a, b) => b.time - a.time);

  return (
    <div className="dchart hist">
      <div className="hist-head">
        <b>Deposits &amp; withdrawals</b>
        <small className="dim">Only you see this · last 90 days</small>
      </div>
      {q.isLoading ? (
        <p className="dim">Loading…</p>
      ) : q.isError ? (
        <p className="dim">Couldn&apos;t load your history from Hyperliquid. It will retry shortly.</p>
      ) : !rows.length ? (
        <p className="dim">No deposits or withdrawals yet.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.key}>
              <span className={`hico ${r.amount == null ? "" : r.amount >= 0 ? "in" : "out"}`}>
                <Icon name={r.amount == null ? "arrow" : r.amount >= 0 ? "wallet" : "arrow"} size={15} />
              </span>
              <div className="hmain">
                <b>{r.label}</b>
                <small>
                  {r.sub} · {new Date(r.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </small>
                {r.pending && (
                  <small className="hpend">
                    Sent by Hyperliquid, arriving on {chain} within a few minutes.{" "}
                    <a href={`${BRIDGE[HL.network].explorer}/address/${addr}#tokentxns`} target="_blank" rel="noreferrer">
                      Track it
                    </a>
                  </small>
                )}
              </div>
              <div className="hamt">
                {r.amount != null && (
                  <b className={r.amount >= 0 ? "up" : "dn"}>
                    {r.amount >= 0 ? "+" : "−"}
                    {fmt(Math.abs(r.amount))} {r.unit}
                  </b>
                )}
                {r.fee ? <small className="dim">Fee {fmt(r.fee)} USDC</small> : null}
                <a href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer" className="dim">
                  View
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
