"use client";

import { Icon } from "@swellfi/ui";
import { TOKEN_CA, TOKEN_URL } from "@/lib/env";
import { toast } from "@/lib/ui-store";

/** The official token contract address, with copy (and a chart link when configured). */
export function TokenCa({ className = "" }: { className?: string }) {
  if (!TOKEN_CA) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TOKEN_CA);
      toast("Contract address copied");
    } catch {
      toast("Couldn't copy. Select the address and copy it by hand.", "err");
    }
  };
  return (
    <div className={`token-ca ${className}`}>
      <span className="token-ca-tag">CA</span>
      <code title={TOKEN_CA}>
        <span className="token-ca-full">{TOKEN_CA}</span>
        <span className="token-ca-short">
          {TOKEN_CA.slice(0, 8)}…{TOKEN_CA.slice(-6)}
        </span>
      </code>
      <button className="token-ca-btn" onClick={copy} aria-label="Copy contract address" title="Copy">
        <Icon name="copy" size={15} />
      </button>
      {TOKEN_URL && (
        <a className="token-ca-btn" href={TOKEN_URL} target="_blank" rel="noopener noreferrer" aria-label="Open chart" title="Chart">
          <Icon name="arrow" size={15} />
        </a>
      )}
    </div>
  );
}
