"use client";

import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { api, ApiError, setTokenGetter, type Me } from "./api";
import { BRAND, HL, PRIVY_APP_ID } from "./env";
import { openModal, toast } from "./ui-store";

export type SessionStatus = "loading" | "anon" | "needsInvite" | "ready";

export interface Session {
  /** False when NEXT_PUBLIC_PRIVY_APP_ID isn't set: login is disabled. */
  configured: boolean;
  status: SessionStatus;
  me: Me | null;
  /** The Privy user's master wallet (embedded or external). */
  walletAddress: string | null;
  inviteOnly: boolean;
  login(method: "email" | "wallet"): void;
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

function NoAuthSession({ children }: { children: ReactNode }) {
  const inviteOnly = useInviteOnly();
  const value = useMemo<Session>(
    () => ({
      configured: false,
      status: "anon",
      me: null,
      walletAddress: null,
      inviteOnly,
      login: () => toast("Login isn't configured yet (set NEXT_PUBLIC_PRIVY_APP_ID)"),
      logout: async () => {},
      getMasterWallet: async () => {
        throw new Error("Login isn't configured");
      },
    }),
    [inviteOnly],
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
  if (!PRIVY_APP_ID) return <NoAuthSession>{children}</NoAuthSession>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#16C784",
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
