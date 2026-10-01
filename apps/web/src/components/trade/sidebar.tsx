"use client";

import { useQuery } from "@tanstack/react-query";
import { displayName } from "@tideline/hl";
import { Avatar, CoinIcon } from "@tideline/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type ChatMsg } from "@/lib/api";
import { useWatchlist } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal } from "@/lib/ui-store";
import { LiveChg, LivePx } from "../live";

function Watchlist({ coin }: { coin: string }) {
  const watch = useWatchlist();
  const byName = useMarkets((s) => s.byName);
  const [open, setOpen] = useState(true);
  const list = watch.coins.filter((n) => byName[n]);
  return (
    <div className="blk">
      <button className={`blk-h${open ? "" : " closed"}`} onClick={(e) => ((e.target as Element).closest("#wlEdit") ? openModal("picker") : setOpen((o) => !o))}>
        <span className="car">▾</span>
        <span style={{ color: "#F5B53D" }}>★</span>Watchlist <span className="dim">{list.length}</span>
        <span className="spacer" />
        <span className="dim" id="wlEdit" title="Add markets">
          +
        </span>
      </button>
      {open && (
        <div>
          {list.length ? (
            list.map((n) => (
              <Link key={n} className={`wl${n === coin ? " on" : ""}`} href={tradeHref(n)}>
                <CoinIcon name={n} size={22} />
                <b>{displayName(n)}</b>
                <span className="p">
                  $<LivePx coin={n} />
                </span>
                <LiveChg coin={n} digits={1} className="c" />
              </Link>
            ))
          ) : (
            <div className="empty" style={{ padding: 16 }}>
              Star markets to add them here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chat() {
  const s = useSession();
  const [open, setOpen] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["chat"], queryFn: () => api<{ messages: ChatMsg[] }>("/chat?limit=60").then((r) => r.messages), refetchInterval: 15_000 });
  const msgs = q.data ?? [];
  const online = useQuery({ queryKey: ["activity", "summary"], queryFn: () => api<{ tradersToday: number }>("/activity/summary"), staleTime: 30_000 });

  useEffect(() => {
    const l = list.current;
    if (l && l.scrollHeight - l.scrollTop - l.clientHeight < 80) l.scrollTop = l.scrollHeight;
  }, [msgs.length]);

  return (
    <div className="blk chat">
      <button className={`blk-h${open ? "" : " closed"}`} onClick={() => setOpen((o) => !o)}>
        <span className="car">▾</span>Global Chat <span className="dot live" style={{ marginLeft: 4 }} />
        <span className="dim" style={{ fontWeight: 400, fontSize: 12, marginLeft: "auto" }}>
          {online.data ? `${online.data.tradersToday} online` : ""}
        </span>
      </button>
      {open && (
        <div className="chat-body">
          <div className="chat-list" ref={list}>
            {msgs.map((m) => (
              <div className="cm" key={m.id}>
                <Avatar seed={m.user.handle} size={26} src={m.user.avatarUrl} />
                <div>
                  <Link href={traderHref(m.user.handle)}>
                    <b>{m.user.handle}</b>
                  </Link>
                  <time>{new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
                  <p>{m.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-in">
            {s.status === "ready" ? (
              <input className="input" placeholder="Chat opens with the social launch" maxLength={240} disabled />
            ) : (
              <div className="signin">
                Sign in to join the conversation.{" "}
                <button style={{ color: "var(--brand)", fontWeight: 600 }} onClick={() => openModal(s.status === "needsInvite" ? "invite" : "wallet")}>
                  Log in
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TradeSidebar({ coin, onCollapse }: { coin: string; onCollapse(): void }) {
  return (
    <aside className="tside" id="tside">
      <div className="tside-h">
        <button className="iconbtn" id="collapse" aria-label="Collapse sidebar" onClick={onCollapse}>
          «
        </button>
      </div>
      <Watchlist coin={coin} />
      <Chat />
    </aside>
  );
}
