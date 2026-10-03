"use client";

import { displayName } from "@swellfi/hl";
import { ago, Avatar, CoinIcon, fPct, fPx, fUsd, Icon, sgn } from "@swellfi/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api, userName, type ActivityItem, type PublicUser } from "@/lib/api";
import { fundHref, traderHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast } from "@/lib/ui-store";

export function TraderCell({ user, size = 34 }: { user: PublicUser; size?: number }) {
  return (
    <div className="who">
      <Avatar seed={user.handle} size={size} src={user.avatarUrl} />
      <div>
        <span className="n">{user.handle}</span>
        <small>{user.addressShort}</small>
      </div>
    </div>
  );
}

/** Follow / unfollow a trader. Signed-out users get the login modal. */
export function FollowButton({ userId, following, className = "follow", big }: { userId: string; following: boolean; className?: string; big?: boolean }) {
  const s = useSession();
  const qc = useQueryClient();
  const [on, setOn] = useState(following);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(following), [following]);
  if (s.me?.user.id === userId) return null;
  return (
    <button
      className={big ? `btn ${on ? "btn-ghost" : "btn-brand"}` : `${className}${on ? " on" : ""}`}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (s.status !== "ready") return openModal(s.status === "needsInvite" ? "invite" : "wallet");
        const next = !on;
        setOn(next);
        setBusy(true);
        try {
          await api(`/users/${encodeURIComponent(userId)}/follow`, { method: next ? "POST" : "DELETE" });
          void qc.invalidateQueries({ queryKey: ["suggestions"] });
          void qc.invalidateQueries({ queryKey: ["activity"] });
          void qc.invalidateQueries({ queryKey: ["user"] });
        } catch (err) {
          setOn(!next);
          toast(err instanceof Error ? err.message : String(err), "err");
        } finally {
          setBusy(false);
        }
      }}
    >
      {on ? "Following" : "Follow"}
    </button>
  );
}

/** One row of the "Live on Swellfi" tape (prototype actHtml). */
export function ActivityRow({ a, now, fresh }: { a: ActivityItem; now: number; fresh?: boolean }) {
  const router = useRouter();
  const d = a.data;
  const tag = a.kind === "whale" ? " 🐋" : a.user.kind === "top" ? " · Top trader" : "";
  const n = (
    <b>
      {userName(a.user)}
      {tag && <span className="dim">{tag}</span>}
    </b>
  );
  let tx: ReactNode = null;
  let sub: ReactNode = null;
  if (a.kind === "verify") {
    tx = (
      <>
        {n}{" "}
        <span className="vf">
          <Icon name="check" size={11} />
        </span>{" "}
        verified <span className="xh">𝕏 @{d.xHandle}</span> on X
      </>
    );
  } else if (a.kind === "fund") {
    tx = (
      <>
        {n} joined{" "}
        <Link href={fundHref(d.fundId ?? "")} onClick={(e) => e.stopPropagation()}>
          <b>{d.fundName}</b>
        </Link>{" "}
        with {d.amount} USDC
      </>
    );
    sub = `${(d.members ?? 0).toLocaleString()} members · ${fPct(d.return30d ?? 0, 1)} in 30 days`;
  } else if (a.kind === "follow") {
    tx = (
      <>
        {n} started following <b>{d.handle}</b>
      </>
    );
    sub = `${fPct(d.roi30d ?? 0, 1)} 30-day ROI`;
  } else if (a.kind === "whale") {
    const big = (d.size ?? 0) >= 1e6 ? `$${((d.size ?? 0) / 1e6).toFixed(2)}M` : `$${Math.round((d.size ?? 0) / 1e3)}K`;
    tx = (
      <>
        {n} {d.side === "buy" ? "bought" : "sold"} <b className={d.side === "buy" ? "up" : "dn"}>{big}</b> of <b>{displayName(d.coin ?? "")}</b>
      </>
    );
    sub = `Hyperliquid market ${d.side === "buy" ? "buy" : "sell"} at ${fPx(d.px)}`;
  } else if (a.kind === "open") {
    tx = (
      <>
        {n} opened{" "}
        <span className={`pill ${d.side === "long" ? "l" : "s"}`}>
          {d.side === "long" ? "Long" : "Short"}
          {d.lev ? ` ${d.lev}x` : ""}
        </span>{" "}
        <b>{displayName(d.coin ?? "")}</b>
      </>
    );
    sub = `${fUsd(d.size ?? 0, 0)} at ${fPx(d.px)}`;
  } else {
    const pnl = d.pnl ?? 0;
    tx = (
      <>
        {n} closed <b>{displayName(d.coin ?? "")}</b> {d.side} for{" "}
        <b className={sgn(pnl)}>
          {pnl >= 0 ? "+" : ""}
          {fUsd(pnl)}
        </b>
      </>
    );
    sub = d.entry != null && d.exit != null ? `${fPx(d.entry)} → ${fPx(d.exit)}${d.lev ? ` · ${d.lev}x` : ""}` : `${d.lev ? `${d.lev}x · ` : ""}${fUsd(d.size ?? 0, 0)} position`;
  }
  return (
    <div className={`act${fresh ? " fresh" : ""}`} style={{ cursor: "pointer" }} onClick={() => router.push(traderHref(a.user.handle))}>
      <Avatar seed={a.user.handle} size={40} src={a.user.avatarUrl} />
      <div className="tx">
        {tx}
        {sub && <small>{sub}</small>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {d.coin && <CoinIcon name={d.coin} size={26} />}
        <time dateTime={a.createdAt}>{ago(new Date(a.createdAt).getTime(), now)}</time>
      </div>
    </div>
  );
}
