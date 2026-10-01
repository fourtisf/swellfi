"use client";

import { create } from "zustand";

export type ToastKind = "ok" | "err" | "info";
export type ModalName = "wallet" | "waitlist" | "invite" | "cmd" | "picker" | "deposit" | "withdraw";

interface UiState {
  modal: ModalName | null;
  toastMsg: string | null;
  toastKind: ToastKind;
  toastKey: number;
  sheetOpen: boolean;
  openModal(m: ModalName): void;
  closeModal(): void;
  toast(msg: string, kind?: ToastKind): void;
  setSheet(open: boolean): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUi = create<UiState>((set) => ({
  modal: null,
  toastMsg: null,
  toastKind: "ok",
  toastKey: 0,
  sheetOpen: false,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setSheet: (sheetOpen) => set({ sheetOpen }),
  toast: (toastMsg, toastKind = "ok") => {
    if (toastTimer) clearTimeout(toastTimer);
    set((s) => ({ toastMsg, toastKind, toastKey: s.toastKey + 1 }));
    toastTimer = setTimeout(() => set({ toastMsg: null }), toastKind === "err" ? 4500 : 2600);
  },
}));

export const toast = (msg: string, kind?: ToastKind) => useUi.getState().toast(msg, kind);
export const toastError = (msg: string) => useUi.getState().toast(msg, "err");
export const openModal = (m: ModalName) => useUi.getState().openModal(m);

/** Shown for social actions that ship with the Phase 3 social launch. */
export const SOON_SOCIAL = "Posting, follows and likes open with the social launch";
