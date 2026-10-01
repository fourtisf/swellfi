"use client";

import { change24h } from "@swellfi/hl";
import { fPct, fPx, sgn } from "@swellfi/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMarkets } from "@/lib/market";

/** Live mid price with the prototype's green/red flash on change. */
export function LivePx({ coin, className, style, prefix = "" }: { coin: string; className?: string; style?: CSSProperties; prefix?: string }) {
  const px = useMarkets((s) => s.mids[coin]);
  const prev = useRef(px);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-dn">("");
  const [k, setK] = useState(0);
  useEffect(() => {
    if (px != null && prev.current != null && px !== prev.current) {
      setFlash(px > prev.current ? "flash-up" : "flash-dn");
      setK((x) => x + 1);
    }
    prev.current = px;
  }, [px]);
  return (
    <span key={k} className={[className, flash].filter(Boolean).join(" ")} style={style}>
      {prefix}
      {fPx(px)}
    </span>
  );
}

export function useChange(coin: string) {
  return useMarkets((s) => {
    const m = s.byName[coin];
    return m ? change24h(m, s.mids[coin]) : 0;
  });
}

/** 24h change. `chip` renders the prototype's colored pill. */
export function LiveChg({ coin, chip, digits = 2, className = "" }: { coin: string; chip?: boolean; digits?: number; className?: string }) {
  const c = useChange(coin);
  return <span className={`${chip ? "chg " : ""}${sgn(c)} ${className}`.trim()}>{fPct(c, digits)}</span>;
}
