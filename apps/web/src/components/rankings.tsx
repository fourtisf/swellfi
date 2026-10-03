"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, fPct, fUsd, sgn, SkelRows, Sparkline } from "@swellfi/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type LeaderRow, type Timeframe } from "@/lib/api";
import { traderHref } from "@/lib/routes";
import { FollowButton, TraderCell } from "./social";

const TFS: [Timeframe, string][] = [
  ["24h", "24h"],
  ["7d", "7d"],
  ["30d", "30d"],
  ["all", "All time"],
];

export function RankingsView() {
  const [tf, setTf] = useState<Timeframe>("7d");
  const router = useRouter();
  const q = useQuery({ queryKey: ["leaderboard", tf], queryFn: () => api<{ rows: LeaderRow[] }>(`/leaderboard?tf=${tf}`).then((r) => r.rows) });
  const rows = q.data ?? [];
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean) as LeaderRow[];

  return (
    <section className="view on" id="v-rankings">
      <div className="page-head">
        <div>
          <h2>Rankings</h2>
          <p>Every trader ranked by recorded PnL. Returns, drawdown and win rate come straight from account history.</p>
        </div>
        <div className="seg">
          {TFS.map(([k, label]) => (
            <button key={k} className={tf === k ? "on" : ""} onClick={() => setTf(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="podium">
        {podium.map((t) => {
          const first = t.rank === 1;
          return (
            <div key={t.user.id} className={`pod ${first ? "first glow-border" : "glass"}`} style={{ borderRadius: "var(--r-lg)" }} onClick={() => router.push(traderHref(t.user.handle))}>
              <span className="medal">{t.rank}</span>
              <Avatar seed={t.user.handle} size={first ? 78 : 62} ring={first} src={t.user.avatarUrl} />
              <div style={{ fontFamily: "var(--display)", fontWeight: 700, fontSize: first ? 20 : 17, marginTop: 12 }}>{t.user.handle}</div>
              <small className="dim">{t.followers.toLocaleString()} followers</small>
              <div className={`pnl ${sgn(+t.pnl)}`}>{fUsd(+t.pnl, 0)}</div>
              <span className={`chg ${sgn(t.roi)}`}>{fPct(t.roi, 1)} ROI</span>
              <Sparkline data={t.series} width={300} height={54} color={first ? "#4DB5FF" : null} full className="sp" />
            </div>
          );
        })}
      </div>
      <div className="glass scroll-x">
        <table>
          <thead>
            <tr>
              <th>Trader</th>
              <th>PnL</th>
              <th>ROI</th>
              <th className="hide-m">Volume</th>
              <th className="hide-m">Win rate</th>
              <th className="hide-m">Max drawdown</th>
              <th className="hide-m">Equity curve</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(3).map((t) => (
              <tr key={t.user.id} className="click" onClick={() => router.push(traderHref(t.user.handle))}>
                <td>
                  <div className="who">
                    <span className="rank">{t.rank}</span>
                    <TraderCell user={t.user} />
                  </div>
                </td>
                <td className={sgn(+t.pnl)}>
                  <b>{fUsd(+t.pnl, 0)}</b>
                </td>
                <td>
                  <span className={`chg ${sgn(t.roi)}`}>{fPct(t.roi, 1)}</span>
                </td>
                <td className="hide-m">{fUsd(+t.volume)}</td>
                <td className="hide-m">{t.winRate == null ? "—" : `${t.winRate.toFixed(1)}%`}</td>
                <td className="hide-m dn">{t.maxDrawdown.toFixed(1)}%</td>
                <td className="hide-m">
                  <Sparkline data={t.series} width={110} height={32} fill={0.2} />
                </td>
                <td>
                  <FollowButton userId={t.user.id} following={t.isFollowing} />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} style={{ padding: 0 }}>
                  {q.isLoading ? <SkelRows n={8} /> : <div className="empty">No ranked traders yet.</div>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
