"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { change24h, displayName } from "@tideline/hl";
import { Avatar, CoinIcon, fPct, fPx, fUsd, Icon, sgn, type IconName } from "@tideline/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type PublicUser } from "@/lib/api";
import { BRAND } from "@/lib/env";
import { useWatchlist } from "@/lib/hooks";
import { useMarkets } from "@/lib/market";
import { NAV, traderHref, tradeHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { Modal } from "./modal";
import { MoneyModals } from "./trade/money-modals";

function WalletModal() {
  const s = useSession();
  const close = useUi((u) => u.closeModal);
  const go = (m: "email" | "wallet") => {
    close();
    s.login(m);
  };
  return (
    <Modal name="wallet" className="glass glow-border">
      <h3>Connect a wallet</h3>
      <p className="mut" style={{ margin: "0 0 6px" }}>
        Funds stay in your own Hyperliquid account. {BRAND} can place trades for you but can never withdraw.
      </p>
      <button className="wopt" onClick={() => go("email")}>
        <i style={{ background: "linear-gradient(135deg,#2EE09C,#0FA968)" }}>@</i>Continue with email<span className="tag">Fastest</span>
      </button>
      <button className="wopt" onClick={() => go("wallet")}>
        <i style={{ background: "#F6A04D" }}>M</i>MetaMask
      </button>
      <button className="wopt" onClick={() => go("wallet")}>
        <i style={{ background: "#8697FF" }}>R</i>Rabby
      </button>
      <button className="wopt" onClick={() => go("wallet")}>
        <i style={{ background: "#5FB2FF" }}>W</i>WalletConnect
      </button>
      <p className="dim" style={{ fontSize: 12, margin: "16px 0 0" }}>
        {s.inviteOnly ? `${BRAND} is invite-only for now. You'll be asked for your invite code after connecting.` : "New here? Connecting creates your account."}
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
      toast(e instanceof Error ? e.message : "Couldn't join the waitlist");
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
  const markets = useMarkets((s) => s.markets);
  const mids = useMarkets((s) => s.mids);
  const watch = useWatchlist();
  const close = useUi((u) => u.closeModal);
  const router = useRouter();
  const [q, setQ] = useState("");
  const list = markets.filter((m) => displayName(m.name).toLowerCase().includes(q.toLowerCase())).slice(0, 100);
  return (
    <Modal name="picker" className="picker glass">
      <h3>Choose a market</h3>
      <div className="sbox" style={{ marginTop: 12 }}>
        <Icon name="search" size={16} />
        <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="list">
        {list.length ? (
          list.map((m) => {
            const c = change24h(m, mids[m.name]);
            return (
              <div className="prow" key={m.name}>
                <button
                  className="pk"
                  onClick={() => {
                    close();
                    router.push(tradeHref(m.name));
                  }}
                >
                  <CoinIcon name={m.name} size={26} />
                  <span style={{ flex: 1 }}>
                    <b>{displayName(m.name)}</b> <span className="pill n">{m.maxLev}x</span>
                    <small className="dim" style={{ display: "block" }}>
                      {fUsd(m.vol)} vol
                    </small>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <span>{fPx(mids[m.name])}</span>
                    <small className={sgn(c)} style={{ display: "block" }}>
                      {fPct(c)}
                    </small>
                  </span>
                </button>
                <button className={`star${watch.has(m.name) ? " on" : ""}`} aria-label="Watchlist" aria-pressed={watch.has(m.name)} onClick={() => watch.toggle(m.name)}>
                  ★
                </button>
              </div>
            );
          })
        ) : (
          <div className="empty">No markets match.</div>
        )}
      </div>
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
  const [last, setLast] = useState("");
  useEffect(() => {
    if (msg) setLast(msg);
  }, [msg]);
  return (
    <div className={`toast glass${msg ? " on" : ""}`} role="status" aria-live="polite">
      <Icon name="check" size={18} />
      {msg ?? last}
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
