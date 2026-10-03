"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { change24h, displayName } from "@swellfi/hl";
import { ago, Avatar, CoinIcon, Empty, fPx, fUsd, Icon } from "@swellfi/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, userName, type ActivityItem, type NewsItem, type PublicUser } from "@/lib/api";
import { BRAND } from "@/lib/env";
import { useNow } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast } from "@/lib/ui-store";
import { LiveChg, LivePx } from "./live";
import { FollowButton } from "./social";
import { useOrderForm } from "./trade/order-store";

type Scope = "global" | "following";
type Kind = "trades" | "open" | "close";
const KIND_LABEL: Record<Kind, string> = { trades: "All", open: "Opens", close: "Closes" };
type Source = "all" | "swellfi" | "whales" | "top";
const SOURCE_LABEL: Record<Source, string> = { all: "All", swellfi: BRAND, whales: "Whales", top: "Top traders" };
const SOURCE_EMPTY: Record<Source, string> = {
  all: `Trades by ${BRAND} traders, Hyperliquid whales and top traders show up here.`,
  swellfi: `Trades placed by ${BRAND} traders show up here within a minute.`,
  whales: "Large market orders on Hyperliquid, live, from traders who aren't on Swellfi.",
  top: "Bigger trades of the most profitable traders on Hyperliquid's leaderboard.",
};

/** Who's behind an event that isn't a Swellfi member's. */
function SourceTag({ a }: { a: ActivityItem }) {
  if (a.kind === "whale")
    return (
      <span className="afi-tag whale" title="A large order on Hyperliquid, by a trader who isn't on Swellfi">
        🐋 Whale
      </span>
    );
  if (a.user.kind === "top")
    return (
      <span className="afi-tag top" title="A top trader on Hyperliquid's leaderboard (not on Swellfi)">
        <Icon name="rank" size={11} />
        Top trader
      </span>
    );
  return null;
}

const fCompact = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : fUsd(v, 2));
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${fUsd(Math.abs(v), Math.abs(v) >= 100 ? 0 : 2)}`;

function useSignIn() {
  const s = useSession();
  return () => {
    if (s.status === "ready") return true;
    openModal(s.status === "needsInvite" ? "invite" : "wallet");
    return false;
  };
}

/** Heart with a count; optimistic, rolls back on error. */
function LikeButton({ a }: { a: ActivityItem }) {
  const signIn = useSignIn();
  const [st, setSt] = useState({ liked: Boolean(a.liked), likes: a.likes ?? 0 });
  return (
    <button
      className={`afa like${st.liked ? " on" : ""}`}
      aria-label={st.liked ? "Unlike" : "Like"}
      onClick={async (e) => {
        e.stopPropagation();
        if (!signIn()) return;
        const prev = st;
        const liked = !st.liked;
        setSt({ liked, likes: Math.max(0, st.likes + (liked ? 1 : -1)) });
        try {
          setSt(await api<{ likes: number; liked: boolean }>(`/activity/${encodeURIComponent(a.id)}/like`, { method: liked ? "POST" : "DELETE" }));
        } catch (err) {
          setSt(prev);
          toast(err instanceof Error ? err.message : String(err), "err");
        }
      }}
    >
      <Icon name="heart" size={17} />
      {st.likes > 0 && <span>{st.likes}</span>}
    </button>
  );
}

function shareText(a: ActivityItem) {
  const d = a.data;
  const coin = displayName(d.coin ?? "");
  const side = d.side === "long" ? "Long" : "Short";
  const who = userName(a.user);
  // Not every event happened on Swellfi: say where.
  const venue = a.user.kind && a.user.kind !== "member" ? "on Hyperliquid, via" : "on";
  if (a.kind === "whale") return `🐋 ${who} ${d.side === "buy" ? "bought" : "sold"} ${fCompact(d.size ?? 0)} of ${coin} at ${fPx(d.px)} ${venue} ${BRAND}`;
  return a.kind === "close"
    ? `${who} closed ${coin} ${side} for ${signed(d.pnl ?? 0)} ${venue} ${BRAND}`
    : `${who} opened ${coin} ${side}${d.lev ? ` ${d.lev}x` : ""} ${venue} ${BRAND}`;
}

function TradeItem({ a, now }: { a: ActivityItem; now: number }) {
  const router = useRouter();
  const d = a.data;
  const coin = d.coin ?? "";
  const long = d.side === "long";
  const opened = a.kind === "open";
  const pnl = d.pnl ?? 0;
  const profile = traderHref(a.user.handle);

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${location.origin}${profile}`;
    const text = shareText(a);
    if (navigator.share) return navigator.share({ text, url }).catch(() => {});
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  };
  // Copy trade = same market, side and leverage in the order panel. Size and confirmation stay with the user.
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    useOrderForm.getState().set({ side: long ? "long" : "short", otype: "market", ...(d.lev ? { lev: d.lev } : {}) });
    router.push(tradeHref(coin));
    toast(`Order panel set to ${displayName(coin)} ${long ? "Long" : "Short"}${d.lev ? ` ${d.lev}x` : ""}. Choose your size, then confirm.`);
  };

  return (
    <article className="afi" onClick={() => router.push(profile)}>
      <Link href={profile} onClick={(e) => e.stopPropagation()} className="afi-av">
        <Avatar seed={a.user.handle} size={48} src={a.user.avatarUrl} />
      </Link>
      <div className="afi-body">
        <div className="afi-top">
          <div className="afi-head">
            <Link href={profile} onClick={(e) => e.stopPropagation()} className="afi-name">
              {userName(a.user)}
            </Link>
            <SourceTag a={a} />
            {a.user.xVerified && (
              <span className="vf" title="Verified on X">
                <Icon name="check" size={11} />
              </span>
            )}
            <span className="afi-verb">{opened ? "opened" : d.liquidated ? "was liquidated on" : "closed"}</span>
            <Link href={tradeHref(coin)} onClick={(e) => e.stopPropagation()} className="afi-coin">
              <CoinIcon name={coin} size={20} />
              {displayName(coin)}
            </Link>
            <span className={`afi-side ${long ? "up" : "dn"}`}>{long ? "Long" : "Short"}</span>
          </div>
          <time className="dim" dateTime={a.createdAt}>
            {ago(new Date(a.createdAt).getTime(), now)}
          </time>
        </div>
        <div className="afi-sub">
          {opened ? (
            <>
              Trade · Opened · {fUsd(d.size ?? 0, 0)} at {fPx(d.px)}
              {d.lev ? ` · ${d.lev}x` : ""}
            </>
          ) : (
            <>
              Trade · Closed · <b className={pnl >= 0 ? "up" : "dn"}>{signed(pnl)}</b>
              {d.entry != null && d.exit != null ? ` · ${fPx(d.entry)} → ${fPx(d.exit)}` : ` · ${fUsd(d.size ?? 0, 0)}`}
            </>
          )}
        </div>
        <div className="afi-actions">
          <button className="afa" onClick={share}>
            <Icon name="share" size={16} />
            Share
          </button>
          {opened && !a.mine && now - new Date(a.createdAt).getTime() < 7 * 864e5 && (
            <button className="afa copy" onClick={copy}>
              <Icon name="trade" size={16} />
              Copy trade
            </button>
          )}
          <span style={{ flex: 1 }} />
          <LikeButton a={a} />
        </div>
      </div>
    </article>
  );
}

/** A large taker order on Hyperliquid by someone who isn't on Swellfi. */
function WhaleItem({ a, now }: { a: ActivityItem; now: number }) {
  const router = useRouter();
  const d = a.data;
  const coin = d.coin ?? "";
  const buy = d.side === "buy";
  const profile = traderHref(a.user.handle);
  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${location.origin}${tradeHref(coin)}`;
    const text = shareText(a);
    if (navigator.share) return navigator.share({ text, url }).catch(() => {});
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  };
  return (
    <article className="afi whale" onClick={() => router.push(tradeHref(coin))}>
      <Link href={profile} onClick={(e) => e.stopPropagation()} className="afi-av">
        <Avatar seed={a.user.handle} size={48} />
      </Link>
      <div className="afi-body">
        <div className="afi-top">
          <div className="afi-head">
            <Link href={profile} onClick={(e) => e.stopPropagation()} className="afi-name">
              {userName(a.user)}
            </Link>
            <SourceTag a={a} />
            <span className="afi-verb">{buy ? "bought" : "sold"}</span>
            <span className={`afi-amt ${buy ? "up" : "dn"}`}>{fCompact(d.size ?? 0)}</span>
            <Link href={tradeHref(coin)} onClick={(e) => e.stopPropagation()} className="afi-coin">
              <CoinIcon name={coin} size={20} />
              {displayName(coin)}
            </Link>
          </div>
          <time className="dim" dateTime={a.createdAt}>
            {ago(new Date(a.createdAt).getTime(), now)}
          </time>
        </div>
        <div className="afi-sub">
          Hyperliquid · Market {buy ? "buy" : "sell"} · {d.sz != null ? `${+d.sz.toPrecision(6)} ${displayName(coin)}` : ""} at {fPx(d.px)}
        </div>
        <div className="afi-actions">
          <button className="afa" onClick={share}>
            <Icon name="share" size={16} />
            Share
          </button>
          <span style={{ flex: 1 }} />
          <LikeButton a={a} />
        </div>
      </div>
    </article>
  );
}

function SummaryBar() {
  const q = useQuery({ queryKey: ["activity", "summary"], queryFn: () => api<{ volumeToday: string; topCoin: string | null; tradersToday: number }>("/activity/summary"), refetchInterval: 30_000 });
  const d = q.data;
  return (
    <div className="afsum">
      <span className="live">
        <i />
        LIVE
      </span>
      <span>
        <b>{d ? fCompact(Number(d.volumeToday)) : "—"}</b> traded today
      </span>
      {d?.topCoin && (
        <span>
          <span className="afi-coin">
            <CoinIcon name={d.topCoin} size={18} />
            {displayName(d.topCoin)}
          </span>{" "}
          most traded
        </span>
      )}
      <span>
        <b>{d?.tradersToday ?? "—"}</b> traders
      </span>
    </div>
  );
}

function SuggestedFollows() {
  const q = useQuery({ queryKey: ["suggestions"], queryFn: () => api<{ traders: { user: PublicUser; isFollowing: boolean; equity: string }[] }>("/suggestions") });
  const traders = q.data?.traders ?? [];
  return (
    <div className="glass">
      <div className="ph">
        <h3>Suggested follows</h3>
      </div>
      {!traders.length ? (
        <p className="dim" style={{ padding: "0 20px 18px", margin: 0, fontSize: 13 }}>
          {q.isLoading ? "Loading…" : "Traders show up here once they trade."}
        </p>
      ) : (
        <ul className="sugg">
          {traders.map((t) => (
            <li key={t.user.id}>
              <Link href={traderHref(t.user.handle)} className="who">
                <Avatar seed={t.user.handle} size={40} src={t.user.avatarUrl} />
                <div>
                  <span className="n">
                    {t.user.handle}
                    {t.user.xVerified && (
                      <span className="vf" style={{ marginLeft: 6 }}>
                        <Icon name="check" size={10} />
                      </span>
                    )}
                  </span>
                  <small>{fCompact(Number(t.equity))} equity</small>
                </div>
              </Link>
              <FollowButton userId={t.user.id} following={t.isFollowing} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MarketNews({ now }: { now: number }) {
  const q = useQuery({ queryKey: ["news"], queryFn: () => api<{ items: NewsItem[] }>("/news"), staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });
  const items = (q.data?.items ?? []).slice(0, 6);
  if (!q.isLoading && !items.length) return null;
  return (
    <div className="glass">
      <div className="ph">
        <h3>Market news</h3>
      </div>
      <ul className="news">
        {items.map((n) => (
          <li key={n.url}>
            <a href={n.url} target="_blank" rel="noopener noreferrer nofollow">
              {n.title}
            </a>
            <small className="dim">
              {n.source}
              {n.publishedAt ? ` · ${ago(new Date(n.publishedAt).getTime(), now)}` : ""}
            </small>
          </li>
        ))}
        {q.isLoading && <li className="dim">Loading…</li>}
      </ul>
    </div>
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
    <div className="glass">
      <div className="ph">
        <h3>Trending markets</h3>
      </div>
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
    </div>
  );
}

/** Activity feed: every trade opened and closed on Swellfi, straight from Hyperliquid. */
export function FeedView() {
  const s = useSession();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("global");
  const [kind, setKind] = useState<Kind>("trades");
  const [source, setSource] = useState<Source>("all");
  const now = useNow(20_000);
  const q = useInfiniteQuery({
    queryKey: ["activity", "feed", scope, kind, source, s.status],
    enabled: scope === "global" || s.status === "ready",
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: ActivityItem[]; nextCursor: string | null }>(`/activity?scope=${scope}&kind=${kind}&source=${source}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="view on" id="v-feed">
      <div className="feed-grid">
        <div>
          <div className="page-head afhead">
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <h2>Activity Feed</h2>
              <select className="afkind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Show">
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="seg">
              <button className={scope === "global" ? "on" : ""} onClick={() => setScope("global")}>
                Global
              </button>
              <button
                className={scope === "following" ? "on" : ""}
                onClick={() => (s.status === "ready" ? setScope("following") : openModal(s.status === "needsInvite" ? "invite" : "wallet"))}
              >
                Following
              </button>
            </div>
          </div>
          <div className="afsrc" role="tablist" aria-label="Source">
            {(Object.keys(SOURCE_LABEL) as Source[]).map((k) => (
              <button key={k} role="tab" aria-selected={source === k} className={source === k ? "on" : ""} onClick={() => setSource(k)}>
                {k === "whales" ? "🐋 " : ""}
                {SOURCE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="glass afeed">
            <SummaryBar />
            {items.length ? (
              items.map((a) => (a.kind === "whale" ? <WhaleItem key={a.id} a={a} now={now} /> : a.kind === "open" || a.kind === "close" ? <TradeItem key={a.id} a={a} now={now} /> : null))
            ) : (
              <Empty icon={<Icon name="feed" size={22} />} title={q.isLoading ? "Loading the feed…" : scope === "following" ? "Nothing from the traders you follow yet" : "No trades yet"}>
                {q.isLoading ? "" : scope === "following" ? "Follow traders from Rankings or the suggestions on the right." : SOURCE_EMPTY[source]}
              </Empty>
            )}
            {q.hasNextPage && (
              <button className="btn btn-ghost afmore" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
          {q.isError && (
            <p className="dim" style={{ fontSize: 13 }}>
              Couldn&apos;t refresh the feed.{" "}
              <button style={{ textDecoration: "underline", color: "inherit" }} onClick={() => void qc.invalidateQueries({ queryKey: ["activity", "feed"] })}>
                Retry
              </button>
            </p>
          )}
        </div>
        <aside className="side-stack">
          <SuggestedFollows />
          <MarketNews now={now} />
          <Trending />
        </aside>
      </div>
    </section>
  );
}
