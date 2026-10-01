"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useUi, type ModalName } from "@/lib/ui-store";

/**
 * Prototype modal shell. Content mounts when opened (so autoFocus works) and stays mounted
 * through the 250 ms fade-out so the box never flashes empty.
 */
export function Modal({ name, className = "", children }: { name: ModalName; className?: string; children: ReactNode }) {
  const on = useUi((s) => s.modal === name);
  const [mounted, setMounted] = useState(on);
  useEffect(() => {
    if (on) return setMounted(true);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [on]);
  return (
    <div className={`modal ${className}${on ? " on" : ""}`} role="dialog" aria-modal="true" aria-hidden={!on}>
      {(on || mounted) && children}
    </div>
  );
}
