"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, getAddress, toHex, type WalletClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { api, ApiError, setTokenGetter, type Me } from "./api";
import { BRAND, HL, PRIVY_APP_ID } from "./env";
import { ensureChain, pickWallet, type InjectedWallet } from "./injected";
import { openModal, toast } from "./ui-store";

export type SessionStatus = "loading" | "anon" | "needsInvite" | "ready";

export interface Session {
  /** True when Privy is configured (email login + embedded wallets); otherwise browser-wallet sign-in. */
  configured: boolean;
  /** Privy (email + embedded wallets) vs. direct browser-wallet sign-in. */
  privy: boolean;
  status: SessionStatus;
  me: Me | null;
  /** The Privy user's master wallet (embedded or external). */
  walletAddress: string | null;
  inviteOnly: boolean;
  /** `walletId` is an EIP-6963 rdns (e.g. "io.metamask") to pick a specific browser wallet. */
  login(method: "email" | "wallet", walletId?: string): void;
  logout(): Promise<void>;
  /**
   * Signer for the master wallet, switched to `chainId` (Arbitrum / Arbitrum Sepolia).
   * Used only for user-signed actions: deposit, approveAgent, approveBuilderFee, withdraw.
   */
  getMasterWallet(chainId: number): Promise<WalletClient>;
}

const SessionCtx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

function useInviteOnly() {
  const q = useQuery({ queryKey: ["config"], queryFn: () => api<{ inviteOnly: boolean }>("/config"), staleTime: 5 * 60_000 });
  return q.data?.inviteOnly ?? true;
}

const WALLET_KEY = "tl:wallet-session";

interface StoredWalletSession {
  token: string;
  address: string;
  walletId: string;
  expiresAt: number;
}

function readStored(): StoredWalletSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(WALLET_KEY) ?? "null") as StoredWalletSession | null;
    return v && v.expiresAt > Date.now() ? v : null;
  } catch {
    return null;
  }
}

/**
 * Sign-in with a browser wallet (MetaMask, Rabby, any EIP-6963 wallet), verified by our API.
 * Used when Privy isn't configured. Email login needs Privy.
 */
function WalletSession({ children }: { children: ReactNode }) {
  const inviteOnly = useInviteOnly();
  const qc = useQueryClient();
  const [sess, setSess] = useState<StoredWalletSession | null>(null);
  const [booted, setBooted] = useState(false);
  const wallet = useRef<InjectedWallet | null>(null);
  const prompted = useRef<string | null>(null);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(WALLET_KEY);
    } catch {
      /* storage blocked */
    }
    wallet.current = null;
    setSess(null);
    qc.removeQueries({ queryKey: ["me"] });
    qc.removeQueries({ queryKey: ["watchlist"] });
    qc.removeQueries({ queryKey: ["rewards"] });
  }, [qc]);

  // Restore a saved session and re-attach to the same wallet.
  useEffect(() => {
    const saved = readStored();
    (async () => {
      if (saved) {
        const w = await pickWallet(saved.walletId);
        const accounts = w ? ((await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[]) : [];
        if (w && accounts.map((a) => a.toLowerCase()).includes(saved.address)) {
          wallet.current = w;
          setSess(saved);
        } else clear();
      }
      setBooted(true);
    })();
  }, [clear]);

  useEffect(() => setTokenGetter(async () => sess?.token ?? null), [sess]);

  // Switching or disconnecting accounts in the wallet ends the session.
  useEffect(() => {
    const p = wallet.current?.provider;
    if (!p || !sess) return;
    const onAccounts = (accs: unknown) => {
      const list = (accs as string[]).map((a) => a.toLowerCase());
      if (!list.includes(sess.address)) {
        clear();
        toast("Wallet changed. Log in again.");
      }
    };
    p.on("accountsChanged", onAccounts);
    return () => p.removeListener("accountsChanged", onAccounts);
  }, [sess, clear]);

  const me = useQuery({
    queryKey: ["me", sess?.address],
    enabled: Boolean(sess),
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 401)) && n < 2,
    queryFn: async () => {
      try {
        return await api<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        if (e instanceof ApiError && e.status === 401) clear();
        throw e;
      }
    },
  });

  let status: SessionStatus = "loading";
  if (booted && !sess) status = "anon";
  else if (sess && me.isSuccess) status = me.data ? "ready" : "needsInvite";
  else if (sess && me.isError) status = "anon";

  useEffect(() => {
    if (status === "needsInvite" && sess && prompted.current !== sess.address) {
      prompted.current = sess.address;
      openModal("invite");
    }
  }, [status, sess]);

  const login = useCallback(
    async (method: "email" | "wallet", walletId?: string) => {
      if (method === "email") return toast("Email login needs Privy (set NEXT_PUBLIC_PRIVY_APP_ID). Use a browser wallet instead.", "info");
      const w = await pickWallet(walletId);
      if (!w) return toast("No browser wallet found. Install MetaMask or Rabby, then try again.", "info");
      try {
        const [address] = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
        if (!address) throw new Error("No account selected");
        const { message } = await api<{ message: string }>("/auth/nonce", { method: "POST", body: { address } });
        const signature = (await w.provider.request({ method: "personal_sign", params: [toHex(message), address as `0x${string}`] })) as string;
        const r = await api<{ token: string; expiresAt: number }>("/auth/wallet", { method: "POST", body: { address, signature } });
        const next: StoredWalletSession = { token: r.token, expiresAt: r.expiresAt, address: address.toLowerCase(), walletId: w.id };
        try {
          localStorage.setItem(WALLET_KEY, JSON.stringify(next));
        } catch {
          /* session lasts for this tab only */
        }
        wallet.current = w;
        setTokenGetter(async () => next.token);
        setSess(next);
        toast(`Connected ${w.name}`);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        toast(/reject|denied/i.test(m) ? "Request cancelled in your wallet" : m, "err");
      }
    },
    [],
  );

  const getMasterWallet = useCallback(
    async (chainId: number) => {
      const w = wallet.current;
      if (!w || !sess) throw new Error("Your wallet isn't connected. Log in again.");
      await ensureChain(w.provider, chainId);
      const chain = chainId === arbitrum.id ? arbitrum : arbitrumSepolia;
      return createWalletClient({ account: getAddress(sess.address), chain, transport: custom(w.provider) });
    },
    [sess],
  );

  const value = useMemo<Session>(
    () => ({
      configured: true,
      privy: false,
      status,
      me: me.data ?? null,
      walletAddress: sess?.address ?? null,
      inviteOnly,
      login: (m, id) => void login(m, id),
      logout: async () => clear(),
      getMasterWallet,
    }),
    [status, me.data, sess, inviteOnly, login, clear, getMasterWallet],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

function PrivySession({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const inviteOnly = useInviteOnly();
  const qc = useQueryClient();
  const promptedFor = useRef<string | null>(null);

  useEffect(() => setTokenGetter(() => getAccessToken()), [getAccessToken]);

  const me = useQuery({
    queryKey: ["me", user?.id],
    enabled: ready && authenticated,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 401)) && n < 2,
    queryFn: async () => {
      try {
        return await api<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null; // logged in, not registered
        throw e;
      }
    },
  });

  let status: SessionStatus = "loading";
  if (ready && !authenticated) status = "anon";
  else if (ready && authenticated && me.isSuccess) status = me.data ? "ready" : "needsInvite";
  else if (ready && authenticated && me.isError) status = "anon";

  // First time we see a Privy login without an account, ask for the invite.
  useEffect(() => {
    if (status === "needsInvite" && user && promptedFor.current !== user.id) {
      promptedFor.current = user.id;
      openModal("invite");
    }
  }, [status, user]);

  const walletAddress = user?.wallet?.address?.toLowerCase() ?? null;
  // The master wallet is the one bound to the account at sign-up, not whichever is newest.
  const masterAddress = me.data?.user.address ?? walletAddress;
  const getMasterWallet = useCallback(
    async (chainId: number) => {
      const w = wallets.find((x) => x.address.toLowerCase() === masterAddress);
      if (!w) throw new Error("Your wallet isn't connected. Reconnect it and try again.");
      if (Number(w.chainId.split(":")[1]) !== chainId) await w.switchChain(chainId);
      const provider = await w.getEthereumProvider();
      const chain = chainId === arbitrum.id ? arbitrum : arbitrumSepolia;
      return createWalletClient({ account: w.address as `0x${string}`, chain, transport: custom(provider) });
    },
    [wallets, masterAddress],
  );

  const value = useMemo<Session>(
    () => ({
      configured: true,
      privy: true,
      status,
      me: me.data ?? null,
      walletAddress,
      inviteOnly,
      getMasterWallet,
      login: (method) => login({ loginMethods: method === "email" ? ["email"] : ["wallet"] }),
      logout: async () => {
        await logout();
        qc.removeQueries({ queryKey: ["me"] });
        qc.removeQueries({ queryKey: ["watchlist"] });
        qc.removeQueries({ queryKey: ["rewards"] });
      },
    }),
    [status, me.data, walletAddress, inviteOnly, login, logout, qc, getMasterWallet],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <WalletSession>{children}</WalletSession>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#4DB5FF",
          landingHeader: `Log in to ${BRAND}`,
          walletChainType: "ethereum-only",
          walletList: ["metamask", "detected_ethereum_wallets", "wallet_connect", "coinbase_wallet"],
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        // Deposits and user-signed Hyperliquid actions happen on Arbitrum (Sepolia on testnet).
        supportedChains: [arbitrum, arbitrumSepolia],
        defaultChain: HL.network === "mainnet" ? arbitrum : arbitrumSepolia,
      }}
    >
      <PrivySession>{children}</PrivySession>
    </PrivyProvider>
  );
}
