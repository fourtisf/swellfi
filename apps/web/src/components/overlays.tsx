"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { change24h, displayName } from "@swellfi/hl";
import { Avatar, CoinIcon, fPct, fPx, fUsd, Icon, sgn, type IconName } from "@swellfi/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type PublicUser } from "@/lib/api";
import { BRAND } from "@/lib/env";
import { useWatchlist } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { discoverWallets, type InjectedWallet } from "@/lib/injected";
import { NAV, traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { matchWallets, WALLETS, walletLogo } from "@/lib/wallets";
import { MarketSelector } from "./markets";
import { Modal } from "./modal";
import { MoneyModals } from "./trade/money-modals";

function WalletModal() {
  const s = useSession();
  const close = useUi((u) => u.closeModal);
  const [installed, setInstalled] = useState<InjectedWallet[]>([]);
  const on = useUi((u) => u.modal === "wallet");
  useEffect(() => {
    if (on) void discoverWallets().then(setInstalled);
  }, [on]);
  const go = (m: "email" | "wallet", id?: string) => {
    close();
    s.login(m, id);
  };
  const { byKey, extra } = useMemo(() => matchWallets(installed), [installed]);
  // Installed wallets first, then the rest in catalog order.
  const entries = useMemo(() => [...WALLETS].sort((a, b) => Number(byKey.has(b.key)) - Number(byKey.has(a.key))), [byKey]);
  return (
    <Modal name="wallet" className="glass glow-border">
      <h3>Connect a wallet</h3>
      <p className="mut" style={{ margin: "0 0 6px" }}>
        Funds stay in your own Hyperliquid account. {BRAND} can place trades for you but can never withdraw.
      </p>
      <button className="wopt" onClick={() => go("email")}>
        <i style={{ background: "linear-gradient(135deg,#9AF1FF,#2F86F0)" }}>@</i>Continue with email{s.privy ? <span className="tag">Fastest</span> : <span className="tag dim">Needs Privy</span>}
      </button>
      <div className="wgrid">
        {extra.map((w) => (
          <button key={w.id} className="wtile" onClick={() => go("wallet", w.id)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {w.icon ? <img src={w.icon} alt="" /> : <i>{w.name.slice(0, 1)}</i>}
            <span className="wn">
              <span className="l">{w.name}</span>
              <span className="s">{w.name}</span>
              <small>Detected</small>
            </span>
          </button>
        ))}
        {entries.map((e) => {
          const w = byKey.get(e.key);
          return (
            <button
              key={e.key}
              className="wtile"
              title={w ? `Connect ${e.name}` : `${e.name} isn't installed in this browser: opens its download page`}
              onClick={() => {
                if (w) return go("wallet", w.id);
                window.open(e.url, "_blank", "noopener,noreferrer");
                toast(`${e.name} isn't installed in this browser. Opening its download page.`);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={walletLogo(e.key)} alt="" />
              <span className="wn">
                <span className="l">{e.name}</span>
                <span className="s">{e.short ?? e.name}</span>
                {w && <small>Detected</small>}
              </span>
            </button>
          );
        })}
      </div>
      <button className="wopt" onClick={() => (s.privy ? go("wallet") : toast("WalletConnect needs Privy (set NEXT_PUBLIC_PRIVY_APP_ID). Use a browser wallet for now."))}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={walletLogo("walletconnect")} alt="" />
        WalletConnect<span className="tag dim">Mobile wallets</span>
      </button>
      <p className="dim" style={{ fontSize: 12, margin: "16px 0 0" }}>
        {s.inviteOnly ? `${BRAND} is invite-only for now. You'll be asked for your invite code after connecting.` : "New here? Connecting creates your account."} You&apos;ll sign a message to prove you own the wallet; it costs no gas.
      </p>
    </Modal>
  );
}

function WaitlistModal() {
  const [email, setEmail] = useState("");
  const [x, setX] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useUi((u) => u.closeModal);
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast("Enter a valid email");
    setBusy(true);
    try {
      await api("/waitlist", { method: "POST", body: { email: email.trim(), xHandle: x.trim() || undefined } });
      close();
      setEmail("");
      setX("");
      toast("You're on the waitlist. We'll email your invite.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't join the waitlist", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal name="waitlist" className="glass glow-border">
      <h3>Join the waitlist</h3>
      <p className="mut" style={{ margin: "0 0 16px" }}>
        {BRAND} is invite-only while we open access in waves. Leave your email and X handle and we&apos;ll send your invite.
      </p>
      <input className="input" type="email" placeholder="you@email.com" style={{ marginBottom: 10 }} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      <input className="input" placeholder="@yourhandle on X (optional)" value={x} onChange={(e) => setX(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn btn-brand submit" onClick={submit} disabled={busy}>
        {busy ? "Joining…" : "Join waitlist"}
      </button>
      <p className="dim" style={{ fontSize: 12.5, margin: "12px 0 0", textAlign: "center" }}>
        Already invited?{" "}
        <button className="mut" style={{ textDecoration: "underline" }} onClick={() => openModal("wallet")}>
          Log in
        </button>
      </p>
    </Modal>
  );
}

function InviteModal() {
  const s = useSession();
  const qc = useQueryClient();
  const close = useUi((u) => u.closeModal);
  const [code, setCode] = useState("");
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr("");
    if (!s.walletAddress) return setErr("Your wallet is still being set up. Try again in a moment.");
    if (s.inviteOnly && !code.trim()) return setErr("Enter your invite code");
    if (!terms) return setErr("Please accept the terms and risk disclosure");
    setBusy(true);
    try {
      let ref: string | undefined;
      try {
        ref = localStorage.getItem("tl:ref") ?? undefined;
      } catch {
        /* storage blocked */
      }
      await api("/invite/redeem", { method: "POST", body: { code: code.trim() || undefined, address: s.walletAddress, acceptTerms: true, ref } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      close();
      toast(`Welcome to ${BRAND}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal name="invite" className="glass glow-border">
      <h3>{s.inviteOnly ? "Enter your invite" : "Finish signing up"}</h3>
      <p className="mut" style={{ margin: "0 0 16px" }}>
        {s.inviteOnly ? `${BRAND} is invite-only while we open access in waves.` : "One last step."} Your account is tied to{" "}
        <b style={{ color: "var(--text)" }}>{s.walletAddress ? `${s.walletAddress.slice(0, 6)}…${s.walletAddress.slice(-4)}` : "your wallet"}</b>.
      </p>
      {s.inviteOnly && (
        <input className="input" placeholder="Invite code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
      )}
      <label className="checkline">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
        <span>
          I accept the{" "}
          <Link href="/terms" onClick={close}>
            Terms and risk disclosure
          </Link>
          . Leverage can liquidate my position, and past performance of other traders does not predict results.
        </span>
      </label>
      {err && <p className="err">{err}</p>}
      <button className="btn btn-brand submit" onClick={submit} disabled={busy}>
        {busy ? "Checking…" : "Continue"}
      </button>
      {s.inviteOnly && (
        <p className="dim" style={{ fontSize: 12.5, margin: "12px 0 0", textAlign: "center" }}>
          No invite yet?{" "}
          <button className="mut" style={{ textDecoration: "underline" }} onClick={() => openModal("waitlist")}>
            Join the waitlist
          </button>
        </p>
      )}
    </Modal>
  );
}

function PickerModal() {
  const close = useUi((u) => u.closeModal);
  const router = useRouter();
  const pathname = usePathname();
  const current = pathname.startsWith("/trade/") ? decodeURIComponent(pathname.slice(7)) : "BTC";
  return (
    <Modal name="picker" className="picker wide glass">
      <h3>Select market</h3>
      <MarketSelector
        current={current}
        onPick={(coin) => {
          close();
          router.push(tradeHref(coin));
        }}
      />
    </Modal>
  );
}

interface CmdItem {
  key: string;
  group: string;
  node: ReactNode;
  run(): void;
}

function CmdModal() {
  const on = useUi((s) => s.modal === "cmd");
  const close = useUi((u) => u.closeModal);
  const markets = useMarkets((s) => s.markets);
  const mids = useMarkets((s) => s.mids);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [dq, setDq] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (on) setQ("");
  }, [on]);

  const traders = useQuery({
    queryKey: ["search", dq],
    enabled: on,
    queryFn: () => api<{ traders: PublicUser[] }>(`/search?q=${encodeURIComponent(dq)}`).then((r) => r.traders),
    staleTime: 30_000,
  });

  const items: CmdItem[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const go = (fn: () => void) => () => {
      close();
      fn();
    };
    const mk = markets.filter((m) => displayName(m.name).toLowerCase().includes(ql)).slice(0, ql ? 8 : 5);
    const pages: { href: string; label: string; icon: IconName }[] = NAV.filter((p) => p.label.toLowerCase().includes(ql));
    return [
      ...mk.map((m) => ({
        key: `m:${m.name}`,
        group: "Markets",
        node: (
          <>
            <CoinIcon name={m.name} size={24} />
            <b>{displayName(m.name)}</b>
            <span className="mut">{fPx(mids[m.name])}</span>
            <small>{fPct(change24h(m, mids[m.name]))}</small>
          </>
        ),
        run: go(() => router.push(tradeHref(m.name))),
      })),
      ...(traders.data ?? []).map((t) => ({
        key: `t:${t.handle}`,
        group: "Traders",
        node: (
          <>
            <Avatar seed={t.handle} size={24} src={t.avatarUrl} />
            <b>{t.handle}</b>
            <small>{t.addressShort}</small>
          </>
        ),
        run: go(() => router.push(traderHref(t.handle))),
      })),
      ...pages.map((p) => ({
        key: `p:${p.href}`,
        group: "Pages",
        node: (
          <>
            <Icon name={p.icon} size={16} />
            <span>{p.label}</span>
            <small>Page</small>
          </>
        ),
        run: go(() => router.push(p.href)),
      })),
    ];
  }, [q, markets, mids, traders.data, router, close]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".it.sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return (
    <Modal name="cmd" className="glass cmd">
      <div className="sbox">
        <Icon name="search" size={16} />
        <input
          className="input"
          placeholder="Search markets, traders and pages"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (items.length) setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
            }
            if (e.key === "Enter") items[sel]?.run();
          }}
        />
      </div>
      <div className="res" ref={listRef}>
        {items.length ? (
          items.map((it, i) => {
            const hd = it.group !== lastGroup ? <div className="grp">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.key}>
                {hd}
                <button className={`it${i === sel ? " sel" : ""}`} onClick={it.run} onMouseEnter={() => setSel(i)}>
                  {it.node}
                </button>
              </div>
            );
          })
        ) : (
          <div className="empty">No results for that search.</div>
        )}
      </div>
    </Modal>
  );
}

function Toast() {
  const msg = useUi((s) => s.toastMsg);
  const kind = useUi((s) => s.toastKind);
  const [last, setLast] = useState<{ msg: string; kind: string }>({ msg: "", kind: "ok" });
  useEffect(() => {
    if (msg) setLast({ msg, kind });
  }, [msg, kind]);
  const k = msg ? kind : last.kind;
  return (
    <div className={`toast glass ${k}${msg ? " on" : ""}`} role={k === "err" ? "alert" : "status"} aria-live="polite">
      <span className="ti">
        <Icon name={k === "err" ? "x" : k === "info" ? "bolt" : "check"} size={14} />
      </span>
      {msg ?? last.msg}
    </div>
  );
}

/** Scrim, modals, toast and global shortcuts. */
export function Overlays() {
  const modal = useUi((s) => s.modal);
  const sheet = useUi((s) => s.sheetOpen);
  const close = useUi((s) => s.closeModal);
  const setSheet = useUi((s) => s.setSheet);
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openModal("cmd");
      }
      if (e.key === "Escape") {
        close();
        setSheet(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [close, setSheet]);

  // Close overlays on navigation.
  useEffect(() => {
    setSheet(false);
  }, [pathname, setSheet]);

  return (
    <>
      <div
        className={`scrim${modal || sheet ? " on" : ""}`}
        onClick={() => {
          close();
          setSheet(false);
        }}
      />
      <WalletModal />
      <WaitlistModal />
      <InviteModal />
      <PickerModal />
      <CmdModal />
      <MoneyModals />
      <Toast />
    </>
  );
}
