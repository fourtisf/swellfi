"use client";

import { displayName } from "@tideline/hl";
import { ago, Avatar, CoinIcon, fPct, fPx, fUsd, Icon, sgn } from "@tideline/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ActivityItem, PublicUser } from "@/lib/api";
import { fundHref, traderHref } from "@/lib/routes";
import { SOON_SOCIAL, toast } from "@/lib/ui-store";

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

export function FollowButton({ following, className = "follow", big }: { following: boolean; className?: string; big?: boolean }) {
  return (
    <button
      className={big ? `btn ${following ? "btn-ghost" : "btn-brand"}` : `${className}${following ? " on" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toast(SOON_SOCIAL);
      }}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}

/** One row of the "Live on Tideline" tape (prototype actHtml). */
export function ActivityRow({ a, now, fresh }: { a: ActivityItem; now: number; fresh?: boolean }) {
  const router = useRouter();
  const d = a.data;
  const n = <b>{a.user.handle}</b>;
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
  } else if (a.kind === "open") {
    tx = (
      <>
        {n} opened{" "}
        <span className={`pill ${d.side === "long" ? "l" : "s"}`}>
          {d.side === "long" ? "Long" : "Short"} {d.lev}x
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
    sub = `${d.lev}x · ${fUsd(d.size ?? 0, 0)} position`;
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
