"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

export interface ConfirmRequest {
  title: string;
  rows: [label: string, value: ReactNode][];
  note?: ReactNode;
  ok: string;
}

/**
 * A review step shown inside the modal instead of the browser's confirm() dialog. `ask` resolves
 * true on confirm and false on back; while a request is open, render `view` in place of the form.
 */
export function useConfirmStep() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback(
    (r: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setReq(r);
      }),
    [],
  );
  const done = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  };
  const view = req && (
    <div className="mconfirm">
      <h3>{req.title}</h3>
      <div className="quotebox">
        {req.rows.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      {req.note && <p className="note">{req.note}</p>}
      <div className="row2">
        <button className="btn btn-ghost" onClick={() => done(false)}>
          Back
        </button>
        <button className="btn btn-brand" autoFocus onClick={() => done(true)}>
          {req.ok}
        </button>
      </div>
    </div>
  );
  return { ask, view };
}
