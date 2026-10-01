"use client";

import { displayName } from "@tideline/hl";
import { Avatar, CoinIcon, fUsd, Icon, Logo, type IconName } from "@tideline/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BRAND, HL } from "@/lib/env";
import { useMarkets } from "@/lib/market";
import { isActive, NAV, traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { useHlAccount } from "@/lib/trading/account";
import { openModal, toast } from "@/lib/ui-store";
import { LiveChg, LivePx } from "./live";

const MORE: { icon: IconName; label: string; run: (r: ReturnType<typeof useRouter>) => void }[] = [
  { icon: "fund", label: "Funds", run: (r) => r.push("/funds") },
  { icon: "chart", label: "Platform stats", run: (r) => r.push("/#stats") },
  { icon: "doc", label: "Documentation", run: () => toast("Docs open in a new tab once they're published") },
  { icon: "globe", label: "Website", run: () => toast("tideline.trade") },
  { icon: "x", label: "Follow on X", run: () => toast("x.com/tideline") },
];

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest("#moreMenu,#moreBtn")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <>
      <button
        id="moreBtn"
        ref={btn}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setPos({ left: r.left, top: r.bottom + 10 });
          setOpen((o) => !o);
        }}
      >
        More <Icon name="chevron" size={14} />
      </button>
      <div className={`menu glass${open ? " on" : ""}`} id="moreMenu" style={{ position: "fixed", ...pos }}>
        {MORE.map((m) => (
          <button
            key={m.label}
            onClick={() => {
              setOpen(false);
              m.run(router);
            }}
          >
            <Icon name={m.icon} size={16} />
            {m.label}
          </button>
        ))}
      </div>
    </>
  );
}

function AccountSlot() {
  const s = useSession();
  const acct = useHlAccount();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".acct-wrap")) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (s.status === "loading") return <span className="dim" style={{ fontSize: 13 }} />;
  if (s.status === "anon") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button className="login" onClick={() => openModal("wallet")}>
          Log in
        </button>
        <button className="btn btn-brand" onClick={() => openModal("waitlist")}>
          Join waitlist
        </button>
      </span>
    );
  }
  const addr = s.me?.user.address ?? s.walletAddress ?? "0x";
  return (
    <div className="acct-wrap" style={{ position: "relative" }}>
      <button className="acct" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
        <span>
          {s.status === "needsInvite" ? <b>Finish sign-up</b> : <b title="Hyperliquid account value">{acct.loaded ? fUsd(acct.summary.accountValue) : "—"}</b>}{" "}
          <span className="mut hide-m">
            {addr.slice(0, 6)}…{addr.slice(-4)}
          </span>
        </span>
        <Avatar seed={addr.slice(2)} size={32} />
      </button>
      <div className={`menu glass${open ? " on" : ""}`} style={{ right: 0, left: "auto" }}>
        {s.status === "needsInvite" ? (
          <button onClick={() => (setOpen(false), openModal("invite"))}>
            <Icon name="check" size={16} />
            Enter invite code
          </button>
        ) : (
          s.me && (
            <button onClick={() => (setOpen(false), router.push(traderHref(s.me!.user.handle)))}>
              <Icon name="rank" size={16} />
              Your profile
            </button>
          )
        )}
        <button
          onClick={async () => {
            setOpen(false);
            await s.logout();
            toast("Logged out");
          }}
        >
          <Icon name="x" size={16} />
          Log out
        </button>
      </div>
    </div>
  );
}

function Status() {
  const ws = useMarkets((s) => s.ws);
  const status = useMarkets((s) => s.status);
  const live = ws === "open" && status === "live";
  const txt = live ? "Live from Hyperliquid" : status === "error" ? "Market data offline" : ws === "closed" ? "Reconnecting" : "Connecting";
  return (
    <div className="status">
      <span className={`dot${live ? " live" : ""}`} />
      <span>{txt}</span>
      {HL.network === "testnet" && <span className="netbadge">Testnet</span>}
    </div>
  );
}

function Ticker() {
  const markets = useMarkets((s) => s.markets);
  const [mode, setMode] = useState<"px" | "pct">("pct");
  const router = useRouter();
  const top = useMemo(
    () => markets.filter((m) => m.kind === "crypto").slice(0, 12).concat(markets.filter((m) => m.kind === "tradfi").slice(0, 6)),
    [markets],
  );
  const items = (suffix: string) =>
    top.map((m) => (
      <span className="tk" key={m.name + suffix} onClick={() => router.push(tradeHref(m.name))}>
        <CoinIcon name={m.name} size={18} />
        <b>{displayName(m.name)}</b>
        <LivePx coin={m.name} />
        <LiveChg coin={m.name} />
      </span>
    ));
  return (
    <div className={`tkwrap${mode === "px" ? " px" : ""}`}>
      <div className="ticker">
        <div className="track">
          {items("")}
          {items("-2")}
        </div>
      </div>
      <div className="tkctl">
        <div className="tkseg">
          <button className={mode === "px" ? "on" : ""} onClick={() => setMode("px")}>
            $
          </button>
          <button className={mode === "pct" ? "on" : ""} onClick={() => setMode("pct")}>
            %
          </button>
        </div>
        <button className="tool" title="Ticker settings" onClick={() => toast("Ticker settings open in a later release")}>
          <Icon name="gear" size={16} />
        </button>
      </div>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const nav = (href: string, label: string, icon: IconName) => (
    <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
      <Icon name={icon} size={16} />
      {label}
    </Link>
  );
  return (
    <header className="top">
      <div className="bar glass">
        <Link href="/" aria-label={`${BRAND} home`}>
          <Logo name={BRAND} />
        </Link>
        <nav className="nav" id="nav">
          {nav("/", "Portfolio", "home")}
          {nav("/trade", "Trade", "trade")}
          {nav("/feed", "Feed", "feed")}
          <button className="soon" title="Coming soon" aria-disabled="true">
            <Icon name="search" size={16} />
            Discovery
          </button>
          {nav("/rankings", "Rankings", "rank")}
          {nav("/rewards", "Rewards", "gift")}
          <MoreMenu />
        </nav>
        <div className="spacer" />
        <button className="sbtn" aria-label="Search" onClick={() => openModal("cmd")}>
          <span style={{ display: "flex" }}>
            <Icon name="search" size={16} />
          </span>
          <span className="sl">Search</span>
          <kbd>⌘K</kbd>
        </button>
        <Status />
        <AccountSlot />
      </div>
      <Ticker />
    </header>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="mnav glass" id="mnav">
      {NAV.slice(0, 5).map((n) => (
        <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
          <Icon name={n.icon} size={20} />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function Footer() {
  return (
    <footer>
      <div className="logo" style={{ fontSize: 17 }}>
        {BRAND}
      </div>
      <nav>
        <Link href="/trade">Trade</Link>
        <Link href="/rankings">Rankings</Link>
        <Link href="/funds">Funds</Link>
        <Link href="/rewards">Rewards</Link>
        <Link href="/terms">Terms &amp; risks</Link>
      </nav>
      <div style={{ maxWidth: "52ch" }}>
        Perpetuals use leverage and can lose more than you expect. Past performance of any trader or fund does not predict future
        results. {BRAND} is non-custodial: your funds stay in your own Hyperliquid account.
      </div>
    </footer>
  );
}
