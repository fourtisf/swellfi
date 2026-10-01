# Implementation plan: Phase 1 and Phase 2

The spec is `docs/HANDOFF.md` and the UI source of truth is `docs/tideline-prototype.html`. Verified API facts are in `NOTES.md`.

## Monorepo layout (pnpm workspaces)

```
apps/web        Next.js 14 App Router. All screens, Privy login, live Hyperliquid market data
apps/api        Fastify 5. REST /api/*, WebSocket /ws, Privy token verification, rate limits (Redis)
apps/indexer    (Phase 3) Fills/positions → Postgres, leaderboards → Redis sorted sets
packages/db     Prisma schema, migrations, client, dev seed
packages/hl     Hyperliquid helpers: config/network, info client, shared WS, markets + asset ids,
                order estimates; Phase 2 adds exchange/signing (via @nktkas/hyperliquid)
packages/ui     Prototype CSS (verbatim), design tokens, formatters, icons, coin/avatar/sparkline
deploy/         PM2 ecosystem, Nginx site (WebSocket proxying), deploy.sh
```

## Phase 1: Foundation (read-only) ✅ built

| Area | Module |
|---|---|
| Env/config | Root `.env`; `packages/hl/config.ts` (testnet default, mainnet only by name); `apps/api/src/env.ts` (zod) |
| DB | `packages/db/prisma/schema.prisma` (HANDOFF §5.1 expanded: `isDemo`, `termsAcceptedAt`, `DailyStat.wins/closedTrades`, `Fund`), migration `init`, `seed.ts` |
| Market data | `packages/hl` (`loadMarkets` incl. HIP-3 via `perpDexs`, `HlSocket` ref-counted subs + heartbeat) → `apps/web/src/lib/market.ts` (zustand store, 900 ms mid batching like the prototype) |
| Screens | `/`, `/trade`, `/trade/[coin]`, `/feed`, `/rankings`, `/u/[handle]` (drawer → page), `/funds`, `/funds/[id]`, `/rewards`, `/terms`, `/r/[code]` |
| Modals | Wallet, waitlist, invite (new), ⌘K search, market picker |
| Chart | `lightweight-charts` styled like the prototype canvas (candles, volume, area, OHLC float, local time) until TradingView is approved |
| Auth | Privy (email + embedded wallet, external wallets) → API verifies the access token → `/api/me` |
| Gating | `INVITE_ONLY`: Privy login → invite modal → `POST /api/invite/redeem` (code, terms, wallet must be linked to the Privy user) |
| Watchlist | `GET/POST /api/watchlist` per user; localStorage for visitors |
| Social reads | `/api/stats`, `/activity`, `/activity/summary`, `/leaderboard?tf=`, `/users/:handle(/stats)`, `/feed`, `/suggestions`, `/chat`, `/funds`, `/rewards`, `/search`, computed from Postgres (seeded in dev) with a Redis cache |
| Admin | `/api/admin/waitlist`, `…/:id/approve` (issues an invite code), `/api/admin/invites` |
| WS gateway | `/ws`: `activity`, `chat`, `user:{id}` channels over Redis pub/sub (producers arrive in Phase 3) |
| Ops | PM2 ecosystem, Nginx (TLS, `/api`, `/ws` upgrade), `deploy.sh`, docker-compose for local PG/Redis |
| Tests | `packages/hl` (13), `packages/ui` (4), `apps/api` integration (10, real PG + Redis), Playwright smoke (8) against a local mock Hyperliquid (`apps/web/e2e/mock-hl.mjs`) |

Phase 1 deliberately does **not** do the following. These buttons show a "coming soon" toast:

- Order placement, deposit and withdraw: Phase 2.
- Posting, following, likes and chat sends: Phase 3.
- Fund invest/create: Phase 4.
- Reward claims: Phase 4.

## Phase 2: Real trading (testnet first) ✅ built, awaiting testnet acceptance run

**packages/hl/src/exchange.ts**: a thin wrapper over pinned `@nktkas/hyperliquid`:

- `buildOrder`: market = IOC limit at mid ± slippage; limit = GTC/ALO; stop market/limit = trigger; TP/SL via `normalTpsl`/`positionTpsl`.
- Rounding: 5 sig figs and `6 − szDecimals`; enforce the $10 minimum.
- `builder: {b, f}` on every order, from env.
- Asset ids from `markets.ts`.

**apps/web/src/lib/trading/**:

- `agent.ts`: generate the agent key client-side and store it encrypted (WebCrypto AES-GCM; key derived from a Privy-wallet signature, kept in IndexedDB). It never leaves the browser.
- `onboarding.ts`: the 3-step checklist in the order panel. It reads state from `extraAgents`, `maxBuilderFee` and `clearinghouseState`.
  1. Deposit.
  2. `approveAgent` (named, `valid_until`, signed by the master wallet).
  3. `approveBuilderFee` (`"0.05%"`, signed by the master wallet).
- `deposit.ts`: USDC on Arbitrum → Bridge2 (or CCTP; to decide). Includes a balance check, a hard **5 USDC minimum**, tx status, and a credit confirmation by polling `clearinghouseState`.
- `withdraw.ts`: `withdraw3`, signed by the master wallet, with the 1 USDC fee disclosed.
- `useAccount.ts`: WS `clearinghouseState` + `openOrders` + `orderUpdates` + `userFills`. Feeds the header balance, the Trading Account card, Portfolio and the position lines on the chart.

**Terminal wiring:**

- Order panel submit → `order`; leverage/margin → `updateLeverage`; isolated top-up → `updateIsolatedMargin`.
- Positions table: close = reduce-only IOC.
- Open orders: cancel / `cancelByCloid`.
- Order history (`historicalOrders`), funding history (`userFunding`), analytics from fills.

**HIP-3:** collateral transfer to the dex via `agentSendAsset`, or abstraction mode.

**Safety:**

- The network badge is always visible.
- Mainnet is blocked unless `NEXT_PUBLIC_HL_NETWORK=mainnet`, which needs ALFA's approval.
- A confirm dialog on mainnet.

**Done when:** on testnet, deposit → order → fill → TP hit → withdraw works, and `builderFee` shows on fills.

### Phase 2: what was built

| Area | Module |
|---|---|
| Order construction | `packages/hl/src/trading.ts`: market (IOC ± slippage), limit GTC/ALO, stop market, stop limit, TP/SL children (`normalTpsl`), position TP/SL (`positionTpsl`), close (reduce-only IOC). Uses SDK `formatPrice`/`formatSize`, $10 minimum, **builder object required on every order** |
| Signing | `packages/hl/src/exchange.ts` over `@nktkas/hyperliquid` 0.33.3 (pinned). Agent client for L1 actions; master client (signatureChainId pinned to Arbitrum) for user-signed actions |
| Bridge | `packages/hl/src/bridge.ts`: Bridge2 + USDC addresses per network, exact USDC unit parsing, 5 USDC minimum, 1 USDC withdraw fee |
| Agent key | `apps/web/src/lib/trading/agent-store.ts`: generated in-browser, AES-GCM with a non-extractable key in IndexedDB, fresh address per approval |
| Account data | `apps/web/src/lib/trading/account.ts`: clearinghouseState per dex (+ spot balances for unified accounts), open orders, agents, builder approval, fills, history, funding; WS-driven refresh |
| Actions | `apps/web/src/lib/trading/use-trading.ts`: enable trading, deposit (+ credit polling), withdraw, leverage sync, HIP-3 collateral top-up, place/cancel/close |
| UI | Order panel (3-step checklist, live submit, % of balance, Margin/USD/coin sizing, Post Only, slippage, stop limit, mainnet double-confirm), deposit/withdraw modals, live Positions/Open Orders/Order History/Funding/Analytics, Trading Account card, header balance, Portfolio card, entry/liquidation lines on the chart |
| Tests | `packages/hl`: 26 tests, incl. signatures recovered to the agent (L1) and checked user-signed payloads (`Testnet`, `0x66eee`, `"0.05%"`) |

**Not yet verified** (needs the testnet run in README → "Testnet runbook"):

- The full lifecycle against Hyperliquid testnet: this build environment can't reach Hyperliquid or Privy.

**Deferred:**

- Gas sponsorship for embedded-wallet deposits (Privy dashboard + `sponsor` option).
- CCTP deposits.
- Scale/TWAP orders.
- Isolated margin top-up UI (`updateIsolatedMargin` is in the SDK).
- Position TP/SL editing on existing positions (builder exists: `buildPositionTpsl`).
