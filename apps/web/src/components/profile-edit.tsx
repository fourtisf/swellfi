"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Avatar } from "@swellfi/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type PublicUser } from "@/lib/api";
import { traderHref } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { toast, useUi } from "@/lib/ui-store";
import { Modal } from "./modal";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const BIO_MAX = 160;

function handleError(h: string): string | null {
  if (h.length < 3) return "At least 3 characters";
  if (h.length > 20) return "At most 20 characters";
  if (!HANDLE_RE.test(h)) return "Use only letters, numbers and _";
  if (/^_|_$|__/.test(h)) return "Can't start or end with _ or have __";
  return null;
}

/** Square-crop and shrink a picture to 256×256 in the browser, as WebP (JPEG where WebP can't be encoded). */
async function toAvatar(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG or WebP image");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is too large (max 15 MB)");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const g = canvas.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    for (const [type, q] of [["image/webp", 0.86], ["image/jpeg", 0.86], ["image/jpeg", 0.7]] as const) {
      const out = canvas.toDataURL(type, q);
      // Browsers that can't encode a type fall back to PNG; skip those and anything too big.
      if (out.startsWith(`data:${type};`) && out.length < 250_000) return out;
    }
    throw new Error("Couldn't shrink that image. Try another one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Edit your own username, bio and profile picture. */
export function EditProfileModal() {
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const close = useUi((u) => u.closeModal);
  const on = useUi((u) => u.modal === "profile");
  const me = s.me?.user;
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [picture, setPicture] = useState<string | null>(null); // new picture (data URL)
  const [removePic, setRemovePic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!on || !me) return;
    setHandle(me.handle);
    setBio(me.bio ?? "");
    setIsPublic(me.isPublic);
    setPicture(null);
    setRemovePic(false);
    setErr("");
  }, [on, me]);

  if (!me) return null;
  const h = handle.trim().toLowerCase();
  const hErr = h === me.handle ? null : handleError(h);
  const shown = picture ?? (removePic ? null : me.avatarUrl);
  const dirty = h !== me.handle || bio.trim() !== (me.bio ?? "") || isPublic !== me.isPublic || picture != null || removePic;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    try {
      setPicture(await toAvatar(f));
      setRemovePic(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const save = async () => {
    if (hErr) return setErr(hErr);
    setBusy(true);
    setErr("");
    try {
      let user: PublicUser = me;
      if (h !== me.handle || bio.trim() !== (me.bio ?? "") || isPublic !== me.isPublic) user = (await api<{ user: PublicUser }>("/me/profile", { method: "POST", body: { handle: h, bio, isPublic } })).user;
      if (picture) user = (await api<{ user: PublicUser }>("/me/avatar", { method: "POST", body: { image: picture } })).user;
      else if (removePic) user = (await api<{ user: PublicUser }>("/me/avatar", { method: "DELETE" })).user;
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["user"] });
      close();
      toast("Profile saved");
      if (user.handle !== me.handle) router.replace(traderHref(user.handle));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal name="profile" className="glass glow-border wide-short">
      <h3>Edit profile</h3>
      <p className="mut" style={{ margin: "0 0 14px" }}>
        Shown on your public profile, posts and rankings.
      </p>
      <div className="pedit-pic">
        <Avatar seed={me.handle} size={72} ring src={shown} />
        <div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <button className="btn btn-ghost" disabled={busy} onClick={() => file.current?.click()}>
            {shown ? "Change picture" : "Upload picture"}
          </button>
          {shown && (
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setPicture(null);
                setRemovePic(true);
              }}
            >
              Remove
            </button>
          )}
          <small className="dim">PNG, JPEG or WebP. Cropped to a square.</small>
        </div>
      </div>
      <div className="field pedit-field">
        <label>
          <span>Username</span>
          <span className={hErr ? "dn" : "dim"}>{hErr ?? `swellfi.xyz/u/${h || "…"}`}</span>
        </label>
        <div className="wrap">
          <input className="input" value={handle} maxLength={20} disabled={busy} autoComplete="off" spellCheck={false} onChange={(e) => setHandle(e.target.value.replace(/\s/g, ""))} />
        </div>
      </div>
      <div className="field pedit-field">
        <label>
          <span>Bio</span>
          <span className={bio.length > BIO_MAX ? "dn" : "dim"}>
            {bio.length}/{BIO_MAX}
          </span>
        </label>
        <textarea className="input pedit-bio" rows={3} value={bio} maxLength={BIO_MAX + 20} disabled={busy} placeholder="What do you trade? Tell people about your style." onChange={(e) => setBio(e.target.value)} />
      </div>
      <label className="checkline" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={isPublic} disabled={busy} onChange={(e) => setIsPublic(e.target.checked)} />
        <span>
          <b style={{ color: "var(--text)" }}>Public profile</b>: show my trades in the feed and rankings. Turn off to keep your activity to yourself.
        </span>
      </label>
      {err && <p className="err">{err}</p>}
      <button className="btn btn-brand submit" disabled={busy || !dirty || Boolean(hErr) || bio.length > BIO_MAX} onClick={save}>
        {busy ? "Saving…" : "Save"}
      </button>
    </Modal>
  );
}
