"use client";

import { useQuery } from "@tanstack/react-query";
import { change24h, displayName } from "@swellfi/hl";
import { ago, Avatar, CoinIcon, Empty, fPct, fPx, Icon, Sparkline } from "@swellfi/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type FeedPost, type PublicUser } from "@/lib/api";
import { BRAND } from "@/lib/env";
import { useNow } from "@/lib/hooks";
import { loadSparks, useMarkets } from "@/lib/market";
import { traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, SOON_SOCIAL, toast } from "@/lib/ui-store";
import { LiveChg, LivePx } from "./live";
import { FollowButton, TraderCell } from "./social";

/** Live ROE of an attached position (prototype roeOf). */
function useRoe(p: FeedPost["position"]) {
  const mid = useMarkets((s) => (p ? s.mids[p.coin] : undefined));
  if (!p) return 0;
  return (p.side === "long" ? 1 : -1) * ((mid ?? p.entry) / p.entry - 1) * 100 * p.lev;
}

function PositionCard({ post }: { post: FeedPost }) {
  const p = post.position!;
  const roe = useRoe(p);
  const spark = useMarkets((s) => s.spark[p.coin]);
  const router = useRouter();
  return (
    <div className={`pnlcard ${p.side === "short" ? "s" : ""} ${roe < 0 ? "neg" : ""}`} onClick={() => router.push(tradeHref(p.coin))}>
      <span className="brand">
        <Icon name="bolt" size={13} />
        {BRAND}
      </span>
      <div>
        <div className="lbl">
          <CoinIcon name={p.coin} size={28} />
          {displayName(p.coin)}-USD{" "}
          <span className={`pill ${p.side === "long" ? "l" : "s"}`}>
            {p.side === "long" ? "Long" : "Short"} {p.lev}x
          </span>
        </div>
        <div className="roe">{fPct(roe, 1)}</div>
        <div className="meta">
          <span>
            Entry<b>{fPx(p.entry)}</b>
          </span>
          <span>
            Mark
            <b>
              <LivePx coin={p.coin} />
            </b>
          </span>
        </div>
      </div>
      <div className="hide-m">{spark && <Sparkline data={spark} width={130} height={60} color={p.side === "long" ? "#16C784" : "#EA3943"} fill={0.25} />}</div>
    </div>
  );
}

function Post({ post, now }: { post: FeedPost; now: number }) {
  return (
    <article className="post glass">
      <div className="head">
        <Link href={traderHref(post.user.handle)}>
          <Avatar seed={post.user.handle} size={40} src={post.user.avatarUrl} />
        </Link>
        <div style={{ flex: 1 }}>
          <Link href={traderHref(post.user.handle)}>
            <b>{post.user.handle}</b>
          </Link>
          <br />
          <span>
            {post.user.addressShort} · {ago(new Date(post.createdAt).getTime(), now)}
          </span>
        </div>
        {!post.mine && <FollowButton following={post.isFollowing} />}
      </div>
      <p>{post.text}</p>
      {post.position && <PositionCard post={post} />}
      <div className="pacts">
        <button className={post.liked ? "on" : ""} onClick={() => toast(SOON_SOCIAL)}>
          <Icon name="heart" size={16} />
          {post.likes}
        </button>
        <button onClick={() => toast("Replies open with the social launch")}>
          <Icon name="reply" size={16} />
          {post.replies}
        </button>
        <span className="grow" />
        {post.position && (
          <Link href={tradeHref(post.position.coin)} className="pacts-trade" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, color: "var(--muted)", fontSize: 13 }}>
            <Icon name="trade" size={16} />
            Trade {displayName(post.position.coin)}
          </Link>
        )}
      </div>
    </article>
  );
}

function WhoToFollow() {
  const q = useQuery({ queryKey: ["suggestions"], queryFn: () => api<{ traders: { user: PublicUser; isFollowing: boolean }[] }>("/suggestions") });
  const router = useRouter();
  return (
    <table>
      <tbody>
        {(q.data?.traders ?? []).map((t) => (
          <tr key={t.user.id} className="click" onClick={() => router.push(traderHref(t.user.handle))}>
            <td>
              <TraderCell user={t.user} size={36} />
            </td>
            <td>
              <FollowButton following={t.isFollowing} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Trending() {
  const markets = useMarkets((s) => s.markets);
  const router = useRouter();
  const list = useMemo(() => {
    const mids = useMarkets.getState().mids;
    return markets
      .slice(0, 30)
      .sort((a, b) => Math.abs(change24h(b, mids[b.name])) - Math.abs(change24h(a, mids[a.name])))
      .slice(0, 5);
  }, [markets]);
  return (
    <table>
      <tbody>
        {list.map((m) => (
          <tr key={m.name} className="click" onClick={() => router.push(tradeHref(m.name))}>
            <td>
              <div className="who">
                <CoinIcon name={m.name} size={28} />
                <span className="n">{displayName(m.name)}</span>
              </div>
            </td>
            <td>
              <LivePx coin={m.name} />
            </td>
            <td>
              <LiveChg coin={m.name} chip />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FeedView() {
  const s = useSession();
  const [scope, setScope] = useState<"all" | "following">("all");
  const now = useNow(30_000);
  const q = useQuery({
    queryKey: ["feed", scope, s.status],
    enabled: scope === "all" || s.status === "ready",
    queryFn: () => api<{ items: FeedPost[] }>(`/feed?scope=${scope}`).then((r) => r.items),
    refetchInterval: 30_000,
  });
  const posts = q.data ?? [];
  const coins = [...new Set(posts.flatMap((p) => (p.position ? [p.position.coin] : [])))].join(",");
  useEffect(() => {
    if (coins) void loadSparks(coins.split(","));
  }, [coins]);
  const seed = s.me?.user.handle ?? s.walletAddress?.slice(2) ?? "you";

  return (
    <section className="view on" id="v-feed">
      <div className="feed-grid">
        <div>
          <div className="page-head">
            <div>
              <h2>Feed</h2>
              <p>Market ideas with the position attached. Cards come from the trader&apos;s account, not a screenshot.</p>
            </div>
            <div className="seg">
              <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
                For you
              </button>
              <button
                className={scope === "following" ? "on" : ""}
                onClick={() => (s.status === "ready" ? setScope("following") : openModal(s.status === "needsInvite" ? "invite" : "wallet"))}
              >
                Following
              </button>
            </div>
          </div>
          <div className="glass compose" style={{ marginBottom: 16 }}>
            <div className="r">
              <Avatar seed={seed} size={42} />
              <textarea placeholder="What are you trading? Your latest open position gets attached automatically." />
            </div>
            <div className="bar2">
              <span className="dim" style={{ fontSize: 12.5 }}>
                No open position to attach
              </span>
              <button className="btn btn-brand" style={{ height: 38 }} onClick={() => (s.status === "ready" ? toast(SOON_SOCIAL) : openModal(s.status === "needsInvite" ? "invite" : "wallet"))}>
                Post
              </button>
            </div>
          </div>
          {posts.length ? (
            posts.map((p) => <Post key={p.id} post={p} now={now} />)
          ) : (
            <div className="glass">
              <Empty icon={<Icon name="feed" size={22} />} title={scope === "following" ? "Your following feed is empty" : q.isLoading ? "Loading the feed…" : "No posts yet"}>
                {scope === "following" ? "Follow traders from Rankings or the list on the right." : ""}
              </Empty>
            </div>
          )}
        </div>
        <aside className="side-stack">
          <div className="glass">
            <div className="ph">
              <h3>Who to follow</h3>
            </div>
            <WhoToFollow />
          </div>
          <div className="glass">
            <div className="ph">
              <h3>Trending markets</h3>
            </div>
            <Trending />
          </div>
        </aside>
      </div>
    </section>
  );
}
