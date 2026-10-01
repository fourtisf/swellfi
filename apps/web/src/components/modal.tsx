"use client";

import type { ReactNode } from "react";
import { useUi, type ModalName } from "@/lib/ui-store";

/** Prototype modal shell; content mounts only while open (so autoFocus works). */
export function Modal({ name, className = "", children }: { name: ModalName; className?: string; children: ReactNode }) {
  const on = useUi((s) => s.modal === name);
  return (
    <div className={`modal ${className}${on ? " on" : ""}`} role="dialog" aria-modal="true" aria-hidden={!on}>
      {on && children}
    </div>
  );
}
