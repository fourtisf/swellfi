"use client";

import type { EIP1193Provider } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { BRAND, HL } from "./env";
import type { InjectedWallet } from "./injected";
import { ORIGIN_CHAINS, rpcUrl } from "./trading/networks";

// WalletConnect (mobile wallets via QR code / deep link). Needs a free project id from
// https://cloud.reown.com with this site's domain added to the project's allowlist.
export const WC_ID = "walletconnect";
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

type WcProvider = EIP1193Provider & { disconnect(): Promise<void>; enable(): Promise<string[]>; session?: unknown };

let wc: Promise<InjectedWallet> | null = null;

/** The WalletConnect provider, created once per page (it restores a saved session by itself). */
export function walletConnect(): Promise<InjectedWallet> {
  if (!WC_PROJECT_ID) return Promise.reject(new Error("WalletConnect isn't set up yet (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). Use a browser wallet for now."));
  wc ??= (async () => {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    // The trading chain first; the deposit networks are offered so the wallet can switch to them.
    const home = HL.network === "mainnet" ? arbitrum : arbitrumSepolia;
    const chains = [home, ...ORIGIN_CHAINS.filter((c) => c.id !== home.id)];
    const origin = window.location.origin;
    const provider = await EthereumProvider.init({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      optionalChains: chains.map((c) => c.id) as [number, ...number[]],
      rpcMap: Object.fromEntries(chains.map((c) => [c.id, rpcUrl(c)])),
      metadata: { name: BRAND, description: `${BRAND}: trade perps on Hyperliquid`, url: origin, icons: [`${origin}/apple-icon.png`] },
      qrModalOptions: { themeMode: "dark" },
    });
    return { id: WC_ID, name: "WalletConnect", provider: provider as unknown as EIP1193Provider };
  })().catch((e) => {
    wc = null;
    throw e;
  });
  return wc;
}

/** Ask the wallet for its accounts. WalletConnect pairs first (QR code / deep link). */
export async function requestAccounts(w: InjectedWallet): Promise<string[]> {
  if (w.id === WC_ID) {
    const p = w.provider as WcProvider;
    return p.session ? ((await p.request({ method: "eth_accounts" })) as string[]) : p.enable();
  }
  return (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
}

/** End the WalletConnect session on the phone too (no-op for other wallets). */
export async function disconnectWallet(w: InjectedWallet | null) {
  if (w?.id !== WC_ID) return;
  await (w.provider as WcProvider).disconnect().catch(() => {});
}
