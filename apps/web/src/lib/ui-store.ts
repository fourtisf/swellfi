"use client";

import { create } from "zustand";

export type ModalName = "wallet" | "waitlist" | "invite" | "cmd" | "picker" | "deposit" | "withdraw";

interface UiState {
  modal: ModalName | null;
  toastMsg: string | null;
  toastKey: number;
  sheetOpen: boolean;
  openModal(m: ModalName): void;
  closeModal(): void;
  toast(msg: string): void;
  setSheet(open: boolean): void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUi = create<UiState>((set) => ({
  modal: null,
  toastMsg: null,
  toastKey: 0,
  sheetOpen: false,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),
  setSheet: (sheetOpen) => set({ sheetOpen }),
  toast: (toastMsg) => {
    if (toastTimer) clearTimeout(toastTimer);
    set((s) => ({ toastMsg, toastKey: s.toastKey + 1 }));
    toastTimer = setTimeout(() => set({ toastMsg: null }), 2400);
  },
}));

export const toast = (msg: string) => useUi.getState().toast(msg);
export const openModal = (m: ModalName) => useUi.getState().openModal(m);

/** Shown for social actions that ship with the Phase 3 social launch. */
export const SOON_SOCIAL = "Posting, follows and likes open with the social launch";
