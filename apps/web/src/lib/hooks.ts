"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { toast } from "./ui-store";

const DEFAULT_WATCH = ["BTC", "ETH", "HYPE", "SOL", "xyz:SP500"];
const LS_KEY = "tl:watchlist";

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : DEFAULT_WATCH;
  } catch {
    return DEFAULT_WATCH;
  }
}

/**
 * Watchlist: persisted per user on the API once registered; kept in localStorage for
 * visitors so starring works before login.
 */
export function useWatchlist() {
  const { status } = useSession();
  const qc = useQueryClient();
  const remote = status === "ready";
  const [local, setLocal] = useState<string[]>(DEFAULT_WATCH);
  useEffect(() => setLocal(readLocal()), []);

  const q = useQuery({
    queryKey: ["watchlist"],
    enabled: remote,
    queryFn: () => api<{ coins: string[] }>("/watchlist").then((r) => r.coins),
  });

  const m = useMutation({
    mutationFn: (v: { coin: string; starred: boolean }) => api<{ coins: string[] }>("/watchlist", { method: "POST", body: v }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<string[]>(["watchlist"]);
      qc.setQueryData<string[]>(["watchlist"], (cur = []) => (v.starred ? [...cur.filter((c) => c !== v.coin), v.coin] : cur.filter((c) => c !== v.coin)));
      return { prev };
    },
    onError: (e, _v, c) => {
      qc.setQueryData(["watchlist"], c?.prev);
      toast(e instanceof Error ? e.message : "Couldn't update watchlist");
    },
    onSuccess: (r) => qc.setQueryData(["watchlist"], r.coins),
  });

  const coins = remote ? (q.data ?? []) : local;
  const toggle = (coin: string) => {
    const starred = !coins.includes(coin);
    if (remote) return m.mutate({ coin, starred });
    const next = starred ? [...coins, coin] : coins.filter((c) => c !== coin);
    setLocal(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  return { coins, has: (c: string) => coins.includes(c), toggle };
}

/** Re-render every `ms` (for "3m ago" labels and countdowns). */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
