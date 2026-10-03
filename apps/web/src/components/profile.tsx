"use client";

import { useQuery } from "@tanstack/react-query";
import { Avatar, Empty, fPct, fUsd, Icon, sgn, Sparkline } from "@swellfi/ui";
import Link from "next/link";
import { api, ApiError, type Fund, type PublicUser, type Summary } from "@/lib/api";
import { fundHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast } from "@/lib/ui-store";
import { AccountHistory } from "./account-history";
import { EditProfileModal } from "./profile-edit";
import { FollowButton } from "./social";

interface Profile {
  user: PublicUser;
  followers: number;
  following: number;
  isFollowing: boolean;
  stats: Summary;
  fund: Fund | null;
}

/** Public trader page (/u/[handle]) — the prototype's trader drawer as a shareable page. */
export function ProfileView({ handle }: { handle: string }) {
  const s = useSession();
  const q = useQuery({ queryKey: ["user", handle], queryFn: () => api<Profile>(`/users/${encodeURIComponent(handle)}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });

  if (q.isError) {
    return (
      <div className="profile">
        <Link className="backlink" href="/rankings">
          ← Rankings
        </Link>
        <div className="glass">
          <Empty icon={<Icon name="search" size={22} />} title="Trader not found">
            This profile doesn&apos;t exist or is private.
          </Empty>
        </div>
      </div>
    );
  }
  const d = q.data;
  if (!d) return <div className="profile empty">Loading profile…</div>;
  const t = d.stats;
  const me = s.me?.user.id === d.user.id;
  return (
    <div className="profile">
      <Link className="backlink" href="/rankings">
        ← Rankings
      </Link>
      <div className="who" style={{ marginBottom: 12 }}>
        <Avatar seed={d.user.handle} size={64} ring src={d.user.avatarUrl} />
        <div>
          <h2>{d.user.handle}</h2>
          <small className="dim" style={{ fontSize: 13 }}>
            {d.user.addressShort} · {d.followers.toLocaleString()} followers
            {d.user.xVerified && d.user.xHandle && (
              <>
                {" "}
                · <span className="vf">
                  <Icon name="check" size={11} />
                </span>{" "}
                <span className="xh">𝕏 @{d.user.xHandle}</span>
              </>
            )}
          </small>
        </div>
      </div>
      {d.user.bio && (
        <p className="mut" style={{ margin: "8px 0 16px", whiteSpace: "pre-line", overflowWrap: "anywhere" }}>
          {d.user.bio}
        </p>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        {!me && <FollowButton userId={d.user.id} following={d.isFollowing} big />}
        {me && (
          <button className="btn btn-brand" onClick={() => openModal("profile")}>
            <Icon name="pen" size={16} />
            Edit profile
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={() => {
            navigator.clipboard?.writeText(location.href).catch(() => {});
            toast("Profile link copied");
          }}
        >
          <Icon name="copy" size={16} />
          Share
        </button>
      </div>
      <div className="kv">
        <div>
          <small>30d PnL</small>
          <b className={sgn(+t.pnl)}>{fUsd(+t.pnl, 0)}</b>
        </div>
        <div>
          <small>30d ROI</small>
          <b className={sgn(t.roi)}>{fPct(t.roi, 1)}</b>
        </div>
        <div>
          <small>Account value</small>
          <b>{fUsd(+t.equity, 0)}</b>
        </div>
        <div>
          <small>Win rate</small>
          <b>{t.winRate == null ? "—" : `${t.winRate.toFixed(1)}%`}</b>
        </div>
        <div>
          <small>Max drawdown</small>
          <b className="dn">{t.maxDrawdown.toFixed(1)}%</b>
        </div>
        <div>
          <small>Volume</small>
          <b>{fUsd(+t.volume)}</b>
        </div>
      </div>
      <div className="dchart">
        <div className="mut" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Equity, last 60 days
        </div>
        <Sparkline data={t.series} width={460} height={140} color="#4DB5FF" full />
      </div>
      {me && <AccountHistory user={d.user.address} />}
      {me && <EditProfileModal />}
      {d.fund && (
        <div className="glow-border" style={{ padding: 18, marginTop: 14, borderRadius: 16 }}>
          <div className="mut" style={{ fontSize: 12.5 }}>
            Runs a fund
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 10 }}>
            <div>
              <b style={{ fontFamily: "var(--display)", fontSize: 19 }}>{d.fund.name}</b>
              <div className={sgn(d.fund.return30d)} style={{ fontSize: 13 }}>
                {fPct(d.fund.return30d, 1)} in 30 days
              </div>
            </div>
            <Link className="btn btn-brand" href={fundHref(d.fund.id)}>
              View fund
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
