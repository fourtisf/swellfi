"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, Empty, fPct, fUsd, Icon, Risk, sgn, Sparkline } from "@swellfi/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, type Fund } from "@/lib/api";
import { fundHref, traderHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast } from "@/lib/ui-store";

const FUNDS_SOON = "Funds open in a later release, backed by native Hyperliquid vaults";

export function FundsView() {
  const s = useSession();
  const router = useRouter();
  const q = useQuery({ queryKey: ["funds"], queryFn: () => api<{ funds: Fund[] }>("/funds").then((r) => r.funds) });
  const funds = q.data ?? [];
  const feat = [...funds].sort((a, b) => b.return30d - a.return30d).slice(0, 3);
  return (
    <section className="view on" id="v-funds">
      <div className="page-head">
        <div>
          <h2>Funds</h2>
          <p>Back a trader with USDC. Capital sits in a Hyperliquid vault where you can see every position and withdraw any time.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => (s.status === "ready" ? toast("Fund creation opens after 30 days of recorded trading") : openModal("wallet"))}>
          Create a fund
        </button>
      </div>
      <div className="fgrid">
        {feat.map((f, i) => (
          <div key={f.id} className={`fcard ${i === 0 ? "glow-border" : "glass"}`} style={{ borderRadius: "var(--r-lg)" }} tabIndex={0} role="button" onClick={() => router.push(fundHref(f.id))}>
            <div className="t">
              <div>
                <span className={`pill ${i === 0 ? "b" : "n"}`} style={{ marginBottom: 10 }}>
                  {i === 0 ? "Top performer" : `${f.perfFeePct}% performance fee`}
                </span>
                <h4>{f.name}</h4>
                <div className="who" style={{ marginTop: 8, fontSize: 12.5 }}>
                  <Avatar seed={f.manager.handle} size={22} src={f.manager.avatarUrl} />
                  <span className="mut">{f.manager.handle}</span>
                </div>
              </div>
              <Risk n={f.risk} />
            </div>
            <div className={`ret ${sgn(f.return30d)}`}>{fPct(f.return30d, 1)}</div>
            <small className="dim">30-day return</small>
            <Sparkline data={f.series} width={360} height={80} color="#4DB5FF" full className="sp" />
            <div className="kvs">
              <div>
                <small>AUM</small>
                <b>{fUsd(+f.aum)}</b>
              </div>
              <div>
                <small>Members</small>
                <b>{f.members.toLocaleString()}</b>
              </div>
              <div>
                <small>Minimum</small>
                <b>{+f.minDeposit} USDC</b>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="glass">
        <div className="fund-head">
          <span>All funds</span>
          <span className="hide-sm">AUM</span>
          <span>30d return</span>
          <span className="hide-sm">Risk</span>
          <span className="hide-sm hide-md">Members</span>
          <span className="hide-sm hide-md">30d share value</span>
          <span />
        </div>
        {funds.map((f) => (
          <div key={f.id} className="fund" tabIndex={0} role="button" onClick={() => router.push(fundHref(f.id))}>
            <div className="nm">
              <Avatar seed={f.manager.handle} size={38} src={f.manager.avatarUrl} />
              <div>
                <b>{f.name}</b>
                <small>
                  {f.manager.handle} · {f.perfFeePct}% fee
                </small>
              </div>
            </div>
            <div className="hide-sm">{fUsd(+f.aum)}</div>
            <div>
              <span className={`chg ${sgn(f.return30d)}`}>{fPct(f.return30d, 1)}</span>
            </div>
            <div className="hide-sm">
              <Risk n={f.risk} />
            </div>
            <div className="hide-sm hide-md">{f.members.toLocaleString()}</div>
            <div className="hide-sm hide-md">
              <Sparkline data={f.series} width={130} height={34} fill={0.22} />
            </div>
            <div>
              <span className="btn btn-ghost" style={{ height: 34, fontSize: 13 }}>
                Invest
              </span>
            </div>
          </div>
        ))}
        {!funds.length && <div className="empty">{q.isLoading ? "Loading funds…" : "No funds listed yet."}</div>}
      </div>
    </section>
  );
}

export function FundDetail({ id }: { id: string }) {
  const s = useSession();
  const [amt, setAmt] = useState("");
  const q = useQuery({ queryKey: ["fund", id], queryFn: () => api<{ fund: Fund }>(`/funds/${encodeURIComponent(id)}`).then((r) => r.fund), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  if (q.isError)
    return (
      <div className="profile">
        <Link className="backlink" href="/funds">
          ← Funds
        </Link>
        <div className="glass">
          <Empty icon={<Icon name="fund" size={22} />} title="Fund not found" />
        </div>
      </div>
    );
  const f = q.data;
  if (!f) return <div className="profile empty">Loading fund…</div>;
  return (
    <div className="profile">
      <Link className="backlink" href="/funds">
        ← Funds
      </Link>
      <span className="pill b">Hyperliquid vault</span>
      <h2 style={{ marginTop: 10 }}>{f.name}</h2>
      <div className="who" style={{ marginTop: 10 }}>
        <Avatar seed={f.manager.handle} size={28} src={f.manager.avatarUrl} />
        <span className="mut">
          Managed by{" "}
          <Link href={traderHref(f.manager.handle)} style={{ textDecoration: "underline", color: "var(--text)" }}>
            {f.manager.handle}
          </Link>
        </span>
      </div>
      <p style={{ margin: "16px 0 0" }}>{f.strategy}</p>
      <div className="kv">
        <div>
          <small>AUM</small>
          <b>{fUsd(+f.aum)}</b>
        </div>
        <div>
          <small>30d return</small>
          <b className={sgn(f.return30d)}>{fPct(f.return30d, 1)}</b>
        </div>
        <div>
          <small>Members</small>
          <b>{f.members.toLocaleString()}</b>
        </div>
        <div>
          <small>Performance fee</small>
          <b>{f.perfFeePct}%</b>
        </div>
        <div>
          <small>Max drawdown</small>
          <b className="dn">{f.maxDrawdown.toFixed(1)}%</b>
        </div>
        <div>
          <small>Risk</small>
          <b>
            <Risk n={f.risk} />
          </b>
        </div>
      </div>
      <div className="dchart">
        <div className="mut" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Share value, last 30 days
        </div>
        <Sparkline data={f.series} width={460} height={140} color="#4DB5FF" full />
      </div>
      <div className="glow-border" style={{ padding: 18, marginTop: 14, borderRadius: 16 }}>
        <div className="field">
          <label>
            <span>Amount to invest</span>
            <span>Available — USDC</span>
          </label>
          <div className="wrap">
            <input className="input" inputMode="decimal" placeholder={`Minimum ${+f.minDeposit}`} value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            <span>USDC</span>
          </div>
        </div>
        <div className="summary">
          <div>
            <span>Fee to join</span>
            <span>Free</span>
          </div>
          <div>
            <span>Performance fee on realized profit</span>
            <span>{f.perfFeePct}%</span>
          </div>
          <div>
            <span>Withdrawal</span>
            <span>Any time, from the vault</span>
          </div>
        </div>
        <button className="btn submit c" onClick={() => (s.status === "ready" ? toast(FUNDS_SOON) : openModal(s.status === "needsInvite" ? "invite" : "wallet"))}>
          {s.status === "ready" ? `Invest in ${f.name}` : "Connect wallet to invest"}
        </button>
        <p className="dim" style={{ fontSize: 12, margin: "12px 0 0" }}>
          Your USDC goes into this fund&apos;s Hyperliquid vault. You can see every position it holds and withdraw whenever you like.
        </p>
      </div>
    </div>
  );
}
