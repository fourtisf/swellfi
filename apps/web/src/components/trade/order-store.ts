"use client";

import type { OrderType, Side } from "@tideline/hl";
import { create } from "zustand";

/** Order-entry form state, shared so the order book can fill in a limit price. */
interface OrderForm {
  side: Side;
  otype: OrderType;
  /** limit price or stop trigger, as typed */
  px: string;
  /** stop-limit: limit price once triggered */
  limitPx: string;
  /** size, as typed, in `unit` */
  size: string;
  unit: "margin" | "usd" | "coin";
  lev: number;
  margin: "cross" | "isolated";
  reduceOnly: boolean;
  postOnly: boolean;
  /** max slippage for market / stop-market orders, percent */
  slippage: number;
  showTpSl: boolean;
  tp: string;
  sl: string;
  set(p: Partial<Omit<OrderForm, "set">>): void;
}

export const useOrderForm = create<OrderForm>((set) => ({
  side: "long",
  otype: "limit",
  px: "",
  limitPx: "",
  size: "",
  unit: "margin",
  lev: 10,
  margin: "cross",
  reduceOnly: false,
  postOnly: false,
  slippage: 3,
  showTpSl: false,
  tp: "",
  sl: "",
  set: (p) => set(p),
}));
