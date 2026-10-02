import type { InjectedWallet } from "./injected";

/** A browser wallet offered in the connect modal. Logos live in public/wallets (from @web3icons/core). */
export interface WalletEntry {
  key: string;
  name: string;
  /** Shorter label for narrow screens. */
  short?: string;
  /** EIP-6963 rdns values the wallet announces. */
  rdns: string[];
  /** Fallback match on the announced name, for wallets whose rdns differs between versions. */
  match: RegExp;
  /** Official download page, opened when the wallet isn't installed. */
  url: string;
}

export const WALLETS: WalletEntry[] = [
  { key: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], match: /metamask/i, url: "https://metamask.io/download/" },
  { key: "rabby", name: "Rabby", rdns: ["io.rabby"], match: /rabby/i, url: "https://rabby.io/" },
  { key: "bitget", name: "Bitget Wallet", short: "Bitget", rdns: ["com.bitget.web3"], match: /bitget/i, url: "https://web3.bitget.com/" },
  { key: "okx", name: "OKX Wallet", short: "OKX", rdns: ["com.okex.wallet"], match: /okx/i, url: "https://www.okx.com/web3" },
  { key: "binance", name: "Binance Wallet", short: "Binance", rdns: ["com.binance.wallet"], match: /binance/i, url: "https://www.binance.com/en/web3wallet" },
  { key: "coinbase", name: "Coinbase Wallet", short: "Coinbase", rdns: ["com.coinbase.wallet"], match: /coinbase/i, url: "https://www.coinbase.com/wallet" },
  { key: "trust", name: "Trust Wallet", short: "Trust", rdns: ["com.trustwallet.app"], match: /trust ?wallet/i, url: "https://trustwallet.com/download" },
  { key: "phantom", name: "Phantom", rdns: ["app.phantom"], match: /phantom/i, url: "https://phantom.com/download" },
  { key: "rainbow", name: "Rainbow", rdns: ["me.rainbow"], match: /rainbow/i, url: "https://rainbow.me/" },
  { key: "zerion", name: "Zerion", rdns: ["io.zerion.wallet"], match: /zerion/i, url: "https://zerion.io/" },
  { key: "tokenpocket", name: "TokenPocket", rdns: ["pro.tokenpocket"], match: /tokenpocket/i, url: "https://www.tokenpocket.pro/" },
  { key: "backpack", name: "Backpack", rdns: ["app.backpack"], match: /backpack/i, url: "https://backpack.app/" },
];

export const walletLogo = (key: string) => `/wallets/${key}.svg`;

/**
 * Pairs catalog entries with the wallets installed in this browser (by rdns, then by announced
 * name; each installed wallet is used once). Installed wallets the catalog doesn't know come back
 * as `extra`, so they can still be offered with their own announced icon.
 */
export function matchWallets(installed: InjectedWallet[]) {
  const used = new Set<string>();
  const byKey = new Map<string, InjectedWallet>();
  for (const pass of ["rdns", "name"] as const) {
    for (const e of WALLETS) {
      if (byKey.has(e.key)) continue;
      const hit = installed.find((w) => !used.has(w.id) && (pass === "rdns" ? e.rdns.includes(w.id) : e.match.test(w.name)));
      if (hit) {
        byKey.set(e.key, hit);
        used.add(hit.id);
      }
    }
  }
  return { byKey, extra: installed.filter((w) => !used.has(w.id)) };
}
