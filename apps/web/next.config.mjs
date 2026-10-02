import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// One .env at the repo root for every app.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// forceReload: Next has already loaded apps/web/.env* and caches the result.
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== "production", undefined, true);

const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";

function safeJson(v) {
  try {
    return JSON.parse(v || "{}");
  } catch {
    return {};
  }
}

const hlHosts = [
  "https://api.hyperliquid.xyz",
  "wss://api.hyperliquid.xyz",
  "https://api.hyperliquid-testnet.xyz",
  "wss://api.hyperliquid-testnet.xyz",
  process.env.NEXT_PUBLIC_HL_INFO_URL,
  process.env.NEXT_PUBLIC_HL_WS_URL,
  // Arbitrum RPC for deposits
  "https://arb1.arbitrum.io",
  "https://sepolia-rollup.arbitrum.io",
  process.env.NEXT_PUBLIC_ARB_RPC_URL,
  // Relay (deposits from other networks/tokens) and the origin-chain RPCs it reads balances from
  "https://api.relay.link",
  process.env.NEXT_PUBLIC_RELAY_API_URL,
  "https://*.publicnode.com",
  "https://ethereum.reth.rs",
  "https://mainnet.base.org",
  "https://mainnet.optimism.io",
  "https://56.rpc.thirdweb.com",
  "https://polygon.drpc.org",
  "https://api.avax.network",
  ...Object.values(safeJson(process.env.NEXT_PUBLIC_RPC_URLS)),
].filter(Boolean);

// Report-only until the Privy/WalletConnect host list is confirmed in staging (see NOTES.md).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://auth.privy.io",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://app.hyperliquid.xyz https://assets.relay.link https://*.reown.com https://*.walletconnect.org https://*.walletconnect.com https://explorer-api.walletconnect.com",
  "font-src 'self' data: https://fonts.reown.com",
  `connect-src 'self' ${hlHosts.join(" ")} https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com https://pulse.walletconnect.org https://api.web3modal.org https://*.walletconnect.org https://*.walletconnect.com wss://*.walletconnect.org https://*.reown.com`,
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.org https://secure.walletconnect.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@swellfi/ui", "@swellfi/hl"],
  webpack(config) {
    // Optional Privy peers for features we don't use (Farcaster mini apps, Solana memos,
    // smart wallets). They're imported lazily; stub them so the bundle resolves.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@solana-program/memo": false,
      "@abstract-foundation/agw-client": false,
      permissionless: false,
    };
    return config;
  },
  async rewrites() {
    // In production Nginx routes /api and /ws to the API before requests reach Next.
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy-Report-Only", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
