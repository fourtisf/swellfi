"use client";

import { Icon } from "@swellfi/ui";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { sharePositionHref, shareTradeHref } from "@/lib/routes";
import { openModal, toast, useUi } from "@/lib/ui-store";
import { Modal } from "./modal";

/** What to share: an indexed trade (open/close event) or a member's open position. */
export type ShareTarget = ({ kind: "trade"; id: string } | { kind: "position"; handle: string; coin: string }) & {
  text: string;
  /** The post text when dollar amounts are hidden (defaults to `text`). */
  textNoAmounts?: string;
};

const useTarget = create<{ t: ShareTarget | null; at: number }>(() => ({ t: null, at: 0 }));
export const openShare = (t: ShareTarget) => {
  useTarget.setState({ t, at: Date.now() });
  openModal("share");
};

/** Preview of the PnL card (rendered on the server from real data) and ways to post it. */
export function ShareModal() {
  const { t, at } = useTarget();
  const on = useUi((s) => s.modal === "share");
  const [amounts, setAmounts] = useState(true);
  // Tied to the image URL, so switching options never leaves a stale "ready" for a frame.
  const [loaded, setLoaded] = useState<{ src: string; ok: boolean } | null>(null);
  const [canCopy, setCanCopy] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);

  const page = !t ? "" : t.kind === "trade" ? shareTradeHref(t.id) : sharePositionHref(t.handle, t.coin);
  const q = new URLSearchParams();
  if (t?.kind === "position") q.set("t", String(Math.floor(at / 1000))); // a fresh snapshot each time
  if (!amounts) q.set("amt", "0");
  const img = page ? `${page}/image${q.size ? `?${q}` : ""}` : "";
  const link = page && typeof location !== "undefined" ? `${location.origin}${page}${amounts ? "" : "?amt=0"}` : "";
  const text = (amounts ? t?.text : (t?.textNoAmounts ?? t?.text)) ?? "";

  const state = loaded?.src === img ? (loaded.ok ? "ok" : "err") : "loading";
  useEffect(() => {
    if (!on) return;
    setCanCopy(typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write));
    try {
      setCanShareFiles(Boolean(navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] })));
    } catch {
      setCanShareFiles(false);
    }
  }, [on]);

  const blob = async () => {
    const r = await fetch(img);
    if (!r.ok) throw new Error("The card couldn't be made");
    return r.blob();
  };
  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e) => toast(e instanceof Error ? e.message : String(e), "err"));

  const download = run(async () => {
    const url = URL.createObjectURL(await blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "swellfi-pnl.png" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const copyImage = run(async () => {
    // Safari wants the promise inside the ClipboardItem, created in the click handler.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
    toast("Image copied. Paste it into your post.");
  });
  const copyLink = run(async () => {
    await navigator.clipboard.writeText(link);
    toast("Link copied");
  });
  const nativeShare = run(async () => {
    const file = new File([await blob()], "swellfi-pnl.png", { type: "image/png" });
    await navigator.share({ files: [file], text: `${text} ${link}`.trim() }).catch((e) => {
      if ((e as Error).name !== "AbortError") throw e;
    });
  });
  // X shows the card itself from the link's preview image.
  const postX = () => window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`, "_blank", "noopener,noreferrer");

  return (
    <Modal name="share" className="glass glow-border share-modal">
      <h3>Share your trade</h3>
      <div className={`share-prev ${state}`}>
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={img} src={img} alt="PnL card" width={1200} height={630} onLoad={() => setLoaded({ src: img, ok: true })} onError={() => setLoaded({ src: img, ok: false })} />
        )}
        {state === "loading" && <div className="share-msg">Making your card…</div>}
        {state === "err" && (
          <div className="share-msg">
            {t?.kind === "position" ? "No open position to show, or your profile is private (Edit profile → Public profile)." : "This trade can't be shared (private profile?)."}
          </div>
        )}
      </div>
      <label className="checkline share-amt">
        <input type="checkbox" checked={amounts} onChange={(e) => setAmounts(e.target.checked)} />
        <span>Show dollar amounts (off: percentages only)</span>
      </label>
      <div className="share-actions">
        <button className="btn btn-brand" disabled={state !== "ok"} onClick={postX}>
          Post on 𝕏
        </button>
        {canShareFiles && (
          <button className="btn btn-ghost" disabled={state !== "ok"} onClick={nativeShare}>
            <Icon name="share" size={16} /> Share
          </button>
        )}
        <button className="btn btn-ghost" disabled={state !== "ok"} onClick={download}>
          Download
        </button>
        {canCopy && (
          <button className="btn btn-ghost" disabled={state !== "ok"} onClick={copyImage}>
            Copy image
          </button>
        )}
        <button className="btn btn-ghost" disabled={state !== "ok"} onClick={copyLink}>
          Copy link
        </button>
      </div>
      <p className="dim share-note">Made from your real trade data on Hyperliquid. The link shows this card when posted.</p>
    </Modal>
  );
}
