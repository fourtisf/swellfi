"use client";

import type { EIP1193Provider } from "viem";
import { chainById } from "./trading/networks";
import { WC_ID, walletConnect } from "./walletconnect";

/** A browser wallet announced via EIP-6963 (MetaMask, Rabby, Coinbase, …) or window.ethereum. */
export interface InjectedWallet {
  id: string; // rdns, e.g. "io.metamask"
  name: string;
  icon?: string;
  provider: EIP1193Provider;
}

type LegacyEthereum = EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean };
const legacy = () => (window as unknown as { ethereum?: LegacyEthereum }).ethereum;

const found = new Map<string, InjectedWallet>();
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent).detail as { info: { rdns: string; name: string; icon?: string }; provider: EIP1193Provider };
    if (d?.info?.rdns && d.provider) found.set(d.info.rdns, { id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
  });
}

/** All browser wallets currently available. */
export async function discoverWallets(): Promise<InjectedWallet[]> {
  if (typeof window === "undefined") return [];
  listen();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 150));
  const list = [...found.values()];
  const eth = legacy();
  if (!list.length && eth) {
    list.push({ id: eth.isRabby ? "io.rabby" : eth.isMetaMask ? "io.metamask" : "injected", name: eth.isRabby ? "Rabby" : eth.isMetaMask ? "MetaMask" : "Browser wallet", provider: eth });
  }
  return list;
}

/** Prefer the requested wallet (by rdns), else the first one available. */
export async function pickWallet(preferred?: string): Promise<InjectedWallet | null> {
  if (preferred === WC_ID) return walletConnect();
  const list = await discoverWallets();
  return list.find((w) => w.id === preferred) ?? list[0] ?? null;
}

/** Switch the wallet to `chainId`, adding the chain first if the wallet doesn't know it. */
export async function ensureChain(provider: EIP1193Provider, chainId: number) {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === chainId) return;
  const hex = `0x${chainId.toString(16)}` as `0x${string}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e) {
    const code = (e as { code?: number }).code;
    const chain = chainById(chainId);
    if (code === 4902 || code === -32603) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [...chain.rpcUrls.default.http], blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined }],
      });
    } else throw e;
  }
}
