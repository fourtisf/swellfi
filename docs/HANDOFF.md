# HANDOFF — Tideline (Hyperliquid social trading platform)

Owner: ALFA · Implementation: Michael (via Claude Code)
Working name: **Tideline** (placeholder, keep it configurable via `NEXT_PUBLIC_BRAND_NAME`)
Reference product: app.rayze.io (layout and UX intentionally modeled on it; branding, copy and logo are our own)

---

## 1. What we are building

A non-custodial web app where users:

1. Trade Hyperliquid perpetuals (crypto + HIP-3 stocks/commodities like NVDA, GOLD, S&P500) through our own terminal. Orders go to Hyperliquid's order book. We earn a **builder fee** on every order.
2. Build a public, verifiable track record (profile, PnL, ROI, drawdown, win rate).
3. Follow traders, see a live activity feed, chat in a global chat room, and climb public rankings.
4. (Later) Invest in funds run by top traders (Phase 4, via Hyperliquid Vaults).

Access is **invite-only** at launch (waitlist + invite codes), like Rayze.

## 2. The prototype is the UI source of truth

`tideline-prototype.html` is a single-file working prototype. Open it in a browser — it uses live Hyperliquid market data.

Port the UI pixel-close. Screens:

| Route | Prototype view | Notes |
|---|---|---|
| `/` | `#v-home` | Hero card + 4 platform stats + "Live on" activity feed + markets table + top traders |
| `/trade` and `/trade/[coin]` | `#v-trade` | Full terminal: watchlist + global chat sidebar, chart, Book/Trades/Depth panel, order panel, positions/orders/history tabs, analytics |
| `/feed` | `#v-feed` | Posts with attached live position cards, follow suggestions, trending markets |
| `/rankings` | `#v-rankings` | Podium top 3 + table; timeframes 24h/7d/30d/all |
| `/u/[handle]` | trader drawer | Make this a real shareable page (currently a drawer) |
| `/funds`, `/funds/[id]` | `#v-funds` | Phase 4 |
| `/rewards` | `#v-rewards` | Tiers, referral link, claim |
| Modals | wallet, waitlist, ⌘K search, market picker | Keep all of them |

**What the prototype SIMULATES (must be replaced with real logic):**
- `fill()`, `rest()`, `cancelOrder()`, `closePos()`, `checkOrders()` — demo order engine incl. simulated liquidation/TP/SL. In production these become real Hyperliquid exchange calls; TP/SL and liquidation are handled natively by Hyperliquid.
- Demo balance (10,000 USDC on connect).
- Mock data: `TR` (traders), `FUNDS`, `PLAT` (platform stats), `ACTS` (live activity), `CHAT`, `POSTS`.

**What is already REAL in the prototype (reuse the logic):**
- Market list via `metaAndAssetCtxs` (+ `dex: "xyz"` for HIP-3 markets)
- Candles via `candleSnapshot`, live via WS `candle`
- Order book `l2Book`, trades `trades`, prices `allMids` over WebSocket
- Liquidation price estimate, fee estimate, depth chart

Design tokens (from the prototype's final CSS layer):
- Background `#0E1315`, panel `#13191B`, border `rgba(255,255,255,.075)`
- Text `#E9EDEE`, muted `#8C9598`, dim `#5F686B`
- Brand/long `#16C784`, short `#EA3943`
- Font: Inter. Radius 12–18px. No gradients except subtle button shadow.
- Owner dislikes light/white backgrounds and black-and-gold — keep it dark.

## 3. Stack (use the existing house stack)

- **Frontend:** Next.js 14 (App Router, TypeScript), Tailwind or CSS modules
- **API:** Fastify (TypeScript)
- **DB:** PostgreSQL + Prisma
- **Cache / realtime:** Redis (leaderboards as sorted sets, pub/sub for activity + chat)
- **Hosting:** Hostinger VPS, PM2, Nginx (WebSocket proxying enabled)
- **Auth & wallets:** Privy (email login with embedded wallet + external wallets like MetaMask/Rabby/WalletConnect)
- **Chain libs:** viem
- **Hyperliquid:** a maintained TypeScript SDK (e.g. `@nktkas/hyperliquid`) — check it is current before using; otherwise implement signing per official docs
- **Charts:** TradingView Advanced Charts (free for public platforms but requires applying for access). Fallback: `lightweight-charts`.

Suggested repo layout (monorepo, pnpm workspaces):
```
apps/web        Next.js frontend
apps/api        Fastify REST + WebSocket gateway
apps/indexer    Worker: Hyperliquid fills/positions → Postgres, leaderboards → Redis
packages/db     Prisma schema + client
packages/hl     Hyperliquid helpers (info, ws, exchange, signing, asset ids)
packages/ui     Shared components / tokens
```

## 4. Hyperliquid integration

> ⚠️ Verify every endpoint, payload and limit below against the **current official Hyperliquid docs** before coding. Build and test on **testnet first** (`https://api.hyperliquid-testnet.xyz`, `wss://api.hyperliquid-testnet.xyz/ws`). Do not switch to mainnet without ALFA's explicit go-ahead.

### 4.1 Market data (no auth)
- `POST https://api.hyperliquid.xyz/info`
  - `metaAndAssetCtxs` (and with `dex: "xyz"` for HIP-3 markets)
  - `candleSnapshot`, `l2Book`, `allMids`
- `wss://api.hyperliquid.xyz/ws` subscriptions: `allMids`, `l2Book`, `trades`, `candle`
- Per-user (read): `clearinghouseState`, `openOrders`, `frontendOpenOrders`, `userFills` / `userFillsByTime`, `userFunding`, `portfolio`; WS: `userEvents`, `orderUpdates`, `userFills`, `webData2`

### 4.2 Onboarding flow (must be smooth — biggest drop-off point)
1. Login with Privy (email → embedded wallet, or external wallet).
2. **Deposit:** USDC on Arbitrum → Hyperliquid bridge contract. Show balance, amount input, tx status, and the bridge credit confirmation. **Enforce the bridge minimum deposit (check docs; deposits below the minimum are lost).** Sponsor gas if Privy setup allows.
3. **Enable trading (one-time, user-signed):**
   - `approveAgent` — creates a session/agent key that can place/cancel orders but **cannot withdraw**.
   - `approveBuilderFee` — approves our builder address and max fee.
4. Ready to trade. Show this as a 3-step checklist in the order panel when the user is not set up.

### 4.3 Trading (signed by the agent key)
- `order` (market = IOC limit with slippage; limit GTC/ALO; stop market/limit via trigger orders; TP/SL as `normalTpsl`/`positionTpsl` grouping)
- `cancel` / `cancelByCloid`
- `updateLeverage` (cross/isolated + leverage from the order panel's Margin and Leverage controls)
- `updateIsolatedMargin`
- Every order includes our builder object: `{ b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BPS }` (0.05% = 5 bps = `50` in tenths of a bp — confirm unit in docs).
- `withdraw3` is **user-signed** by the master wallet (not the agent).
- Reduce Only, Post Only (ALO), slippage setting, size in USD or coin, % of balance slider — map prototype controls 1:1.

### 4.4 Builder fee requirements
- Builder wallet must hold the minimum perp account value required by Hyperliquid (check docs).
- Max builder fee for perps is capped by Hyperliquid (check docs). We plan 0.05%.
- Track builder fee revenue from fills (`builderFee` field) into `RewardLedger`.

### 4.5 Key security
- Agent private key is generated **client-side**, encrypted at rest in the browser (or use Privy session signers). **Never send any private key to our server.**
- Server never holds user funds. The app is non-custodial.

## 5. Backend

### 5.1 Prisma models (starting point)
```prisma
model User {
  id           String   @id @default(cuid())
  privyId      String   @unique
  address      String   @unique          // master wallet (lowercase)
  handle       String   @unique
  avatarUrl    String?
  bio          String?
  xHandle      String?
  xVerified    Boolean  @default(false)
  isPublic     Boolean  @default(true)
  referralCode String   @unique
  referredById String?
  inviteCode   String?
  createdAt    DateTime @default(now())
  fills        Fill[]
  stats        DailyStat[]
  posts        Post[]
  watchlist    WatchItem[]
}
model WaitlistEntry { id String @id @default(cuid()) email String @unique xHandle String? status String @default("pending") createdAt DateTime @default(now()) }
model InviteCode    { code String @id ownerId String? usedById String? usedAt DateTime? maxUses Int @default(1) uses Int @default(0) }
model Follow        { followerId String followingId String createdAt DateTime @default(now()) @@id([followerId, followingId]) }
model Fill          { id String @id hash String userId String coin String side String px Decimal sz Decimal fee Decimal builderFee Decimal? closedPnl Decimal dir String time DateTime @@index([userId, time]) }
model DailyStat     { userId String date DateTime pnl Decimal volume Decimal equity Decimal trades Int @@id([userId, date]) }
model Post          { id String @id @default(cuid()) userId String text String position Json? createdAt DateTime @default(now()) likes Int @default(0) }
model Like          { userId String postId String @@id([userId, postId]) }
model ChatMessage   { id String @id @default(cuid()) userId String text String createdAt DateTime @default(now()) deleted Boolean @default(false) }
model WatchItem     { userId String coin String @@id([userId, coin]) }
model RewardLedger  { id String @id @default(cuid()) userId String kind String amount Decimal refFillId String? createdAt DateTime @default(now()) claimedAt DateTime? }
model Activity      { id String @id @default(cuid()) userId String kind String data Json createdAt DateTime @default(now()) @@index([createdAt]) }
```
(Expand as needed. Use Decimal for all money values.)

### 5.2 Services
- **Indexer (apps/indexer):** for every registered user, subscribe/poll fills, positions, funding from Hyperliquid; write `Fill`, roll up `DailyStat` (PnL, volume, equity, drawdown). Respect Hyperliquid rate limits (batch + backoff).
- **Leaderboards:** Redis sorted sets per timeframe (24h/7d/30d/all) by PnL and ROI; recompute incrementally on new fills. Only public profiles.
- **Activity feed:** on open/close/verify/follow/fund-join, write `Activity` + publish to Redis → push to clients via WebSocket (home "Live on" card + `/feed`). Summary line: volume today, most traded coin, active traders.
- **Global chat:** WebSocket room, auth required to post, rate limit (e.g. 1 msg / 3 s), max 240 chars, basic profanity/link filter, admin delete.
- **X verification:** X OAuth 2.0 (PKCE) → store `xHandle`, set `xVerified`, emit "verified on X" activity.
- **Waitlist / invites:** email + X handle signup, admin approves → invite code; login requires valid invite (feature flag to open later).
- **Platform stats endpoint:** global users, TVL (sum of user account values), total volume, trades placed.
- **Rewards:** builder fee rebates + referral share per tier (tiers in prototype `TIERS`). Economics to be confirmed by ALFA — make percentages config, not hard-coded.

### 5.3 API (REST, prefix `/api`)
`GET /stats` · `GET /activity?cursor=` · `GET /leaderboard?tf=` · `GET /users/:handle` · `GET /users/:handle/stats` · `POST /follow/:id` · `DELETE /follow/:id` · `GET /feed?scope=all|following` · `POST /posts` · `POST /posts/:id/like` · `GET/POST /watchlist` · `POST /waitlist` · `POST /invite/redeem` · `GET /rewards` · `POST /rewards/claim` · `GET /auth/x/start` · `GET /auth/x/callback`
WebSocket `/ws`: channels `activity`, `chat`, `user:{id}` (notifications).

## 6. Phases & acceptance criteria

**Phase 1 — Foundation (read-only)**
- Monorepo, Prisma, Redis, PM2/Nginx deploy scripts, env config.
- Port all screens from the prototype with live market data.
- Privy login, waitlist + invite gating, ⌘K search, watchlist persisted per user.
- ✅ Done when: logged-in invited user sees live terminal + markets; all pages match prototype visually on desktop and mobile.

**Phase 2 — Real trading (TESTNET → mainnet after sign-off)**
- Deposit flow, approveAgent, approveBuilderFee, market/limit/stop orders, TP/SL, reduce-only, leverage + margin mode, cancel, close position, withdraw.
- Positions / Open Orders / Order History / Funding History from Hyperliquid (real data).
- Trading Account card from `clearinghouseState`.
- ✅ Done when: full lifecycle works on testnet (deposit → order → fill → TP hit → withdraw) and builder fee appears on fills.

**Phase 3 — Social**
- Indexer, rankings, public profiles `/u/[handle]`, feed with attached position cards, live activity, global chat, X verification, share cards (OG images) for X.
- ✅ Done when: rankings and profile stats match Hyperliquid account history for test users.

**Phase 4 — Rewards & Funds**
- Rewards ledger, referral links, claim.
- Funds via native Hyperliquid Vaults (leader creates vault; we list, display, and route deposits/withdrawals). No custom smart contracts in this phase.

## 7. Compliance & safety (before public launch)
- Terms of Service + risk disclosure (leverage, liquidation, past performance) — shown at signup.
- Geoblocking: at minimum the US and sanctioned jurisdictions; ALFA to confirm others with a lawyer.
- Rate limiting on all API routes, CSP headers, secure cookies, input validation (zod).
- Logging/alerting for indexer lag and WS disconnects.

## 8. Environment variables
```
NEXT_PUBLIC_BRAND_NAME=Tideline
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=
NEXT_PUBLIC_HL_NETWORK=testnet          # testnet | mainnet
NEXT_PUBLIC_BUILDER_ADDRESS=
NEXT_PUBLIC_BUILDER_FEE_TENTHS_BPS=50   # 0.05%
DATABASE_URL=
REDIS_URL=
X_CLIENT_ID=
X_CLIENT_SECRET=
APP_URL=
INVITE_ONLY=true
```

## 9. Open decisions for ALFA
1. Final brand name + domain (Tideline is a placeholder).
2. Builder fee level (plan: 0.05%) and whether to rebate fees through 2026 like Rayze.
3. Referral/tier percentages.
4. TradingView Advanced Charts application (needs company details).
5. Legal entity + jurisdiction list for geoblocking.
6. Differentiator vs Rayze to prioritise (e.g. WhaleFlow alerts in the terminal, one-click copy trading, Telegram bot).
