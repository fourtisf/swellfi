"use client";

import { useQuery } from "@tanstack/react-query";
import { fUsd, Icon } from "@tideline/ui";
import { api, type Tier } from "@/lib/api";
import { BRAND } from "@/lib/env";
import { useSession } from "@/lib/session";
import { openModal, toast } from "@/lib/ui-store";

interface Rewards {
  tiers: Tier[];
  tierIndex: number;
  volume30d: string;
  claimable: string;
  referral: { link: string; invited: number; theirVolume30d: string; earned: string };
}

const GEMS: [string, string][] = [
  ["#16C784", "#1C6FA8"],
  ["#16C784", "#0F8A63"],
  ["#16C784", "#5B45E0"],
  ["#FF8FB1", "#0FA968"],
];

export function RewardsView() {
  const s = useSession();
  const ready = s.status === "ready";
  const mine = useQuery({ queryKey: ["rewards"], enabled: ready, queryFn: () => api<Rewards>("/rewards") });
  const pub = useQuery({ queryKey: ["tiers"], enabled: !ready, queryFn: () => api<{ tiers: Tier[] }>("/rewards/tiers") });
  const tiers = mine.data?.tiers ?? pub.data?.tiers ?? [];
  const ci = mine.data?.tierIndex ?? 0;
  const vol = +(mine.data?.volume30d ?? 0);
  const cur = tiers[ci];
  const nx = tiers[ci + 1];
  const progress = nx && cur ? Math.max(2, Math.min(100, ((vol - cur.minVolume) / (nx.minVolume - cur.minVolume)) * 100)) : 100;
  const claimable = +(mine.data?.claimable ?? 0);
  const ref = mine.data?.referral;
  const needLogin = () => openModal(s.status === "needsInvite" ? "invite" : "wallet");

  return (
    <section className="view on" id="v-rewards">
      <div className="page-head">
        <div>
          <h2>Rewards</h2>
          <p>Through the end of 2026, {BRAND} fees flow back to traders. Invite friends and earn a share of what they trade.</p>
        </div>
      </div>
      <div className="rw-hero">
        <div className="rw-big">
          <div className="mut">Claimable rewards</div>
          <div className="amt">{claimable.toFixed(2)} USDC</div>
          <div className="mut" style={{ marginTop: 20 }}>
            {cur ? (
              <>
                You&apos;re in <b style={{ color: "var(--text)" }}>{cur.name}</b> · {fUsd(vol)} traded in 30 days
              </>
            ) : null}
          </div>
          <div className="prog">
            <i style={{ width: `${progress}%` }} />
          </div>
          <div className="dim" style={{ fontSize: 12.5 }}>
            {nx ? `${fUsd(nx.minVolume - vol)} more volume to reach ${nx.name}` : "Top tier reached"}
          </div>
          <div className="ref">
            <input className="input" readOnly value={ref?.link ?? "Connect a wallet to get your link"} />
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (!ref) return needLogin();
                navigator.clipboard?.writeText(ref.link).catch(() => {});
                toast("Referral link copied");
              }}
            >
              Copy link
            </button>
          </div>
          <button
            className="btn btn-brand"
            style={{ marginTop: 14 }}
            onClick={() => {
              if (!ready) return needLogin();
              if (claimable < 0.01) return toast("Nothing to claim yet. Trade to earn rewards.");
              toast("Claims open with the rewards launch");
            }}
          >
            Claim rewards
          </button>
        </div>
        <div className="glass ref-stats">
          <div>
            <small>Friends invited</small>
            <b>{ref?.invited ?? 0}</b>
          </div>
          <div>
            <small>Their 30d volume</small>
            <b>{fUsd(+(ref?.theirVolume30d ?? 0), 0)}</b>
          </div>
          <div>
            <small>Referral earnings</small>
            <b>{fUsd(+(ref?.earned ?? 0))}</b>
          </div>
          <div>
            <small>Your 30d volume</small>
            <b>{fUsd(vol, 0)}</b>
          </div>
        </div>
      </div>
      <div className="tiers">
        {tiers.map((t, i) => {
          const [a, b] = GEMS[i % GEMS.length]!;
          return (
            <div key={t.name} className={`tier ${i === ci ? "cur" : "glass"}`} style={{ borderRadius: "var(--r-lg)" }}>
              <div className="gem" style={{ background: `linear-gradient(135deg,${a},${b})`, boxShadow: `0 8px 24px -8px ${a}` }}>
                <Icon name="bolt" size={20} />
              </div>
              <h4>{t.name}</h4>
              <small>{t.minVolume ? `${fUsd(t.minVolume, 0)}+ in 30 days` : "Any volume"}</small>
              <div className="rb">{t.rebatePct}%</div>
              <small>
                fee rebate · {t.referralPct}% referral share
              </small>
              {i === ci && ready && (
                <span className="pill b" style={{ marginTop: 12 }}>
                  Your tier
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
