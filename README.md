# Swellfi

Non-custodial Hyperliquid perps trading with a social layer: rankings, feed, live activity and global chat. Production domain: **swellfi.xyz**.

- **Spec:** `docs/HANDOFF.md`
- **UI source of truth:** `docs/tideline-prototype.html`
- **Plan and phase status:** `PLAN.md`
- **Verified Hyperliquid/Privy facts:** `NOTES.md`

> **Status:** Phase 1 (foundation) and Phase 2 (real trading) are built. Trading runs on **Hyperliquid testnet** until mainnet is explicitly approved (`NEXT_PUBLIC_HL_NETWORK`). See "Testnet runbook" below.

## Stack

| Layer | Choice |
|---|---|
| Web | Next.js 14 (App Router, TS), Privy, TanStack Query, zustand, lightweight-charts |
| API | Fastify 5 (TS), zod, `@fastify/rate-limit` (Redis), `@fastify/websocket` |
| Data | PostgreSQL 16 + Prisma 6 (Decimal for money), Redis 7 |
| Ops | PM2 + Nginx on a Hostinger VPS |
| Monorepo | pnpm workspaces: `apps/web`, `apps/api`, `packages/{db,hl,ui}` |

## Prerequisites

- **Node ≥ 22.12.** The Hyperliquid SDK used in Phase 2 requires it. See `.nvmrc`.
- **pnpm 10:** `corepack enable`
- **PostgreSQL 16 and Redis 7.** For local dev, `docker compose up -d` starts both.

## Setup

```bash
pnpm install
cp .env.example .env          # then fill in the values below
pnpm db:generate
pnpm db:migrate               # dev: creates/applies migrations
pnpm db:seed                  # invite codes + (SEED_DEMO=true) demo traders, posts, funds, chat
pnpm dev                      # web on :3000, API on :4000 (Next proxies /api to the API)
```

Then open http://localhost:3000.

- Log in with Privy, then redeem one of the `SEED_INVITE_CODES` (default `SWELL-ALPHA`).
- To make yourself an admin, add your wallet to `ADMIN_ADDRESSES`.

### Environment variables (`.env` at the repo root, read by every app)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | Brand name shown in the UI (`Swellfi`) |
| `APP_URL` | Public origin. Used for CORS and referral links |
| `SESSION_SECRET` | **Required in production** (≥ 32 chars). Signs wallet sign-in sessions |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | **Optional.** Without them, login is a browser wallet (MetaMask, Rabby, any EIP-6963 wallet) signing a one-time message that the API verifies. With them, Privy adds email login, embedded wallets and WalletConnect |
| `PRIVY_VERIFICATION_KEY` | Optional. Verifies tokens locally, without fetching Privy's JWKS |
| `NEXT_PUBLIC_HL_NETWORK` | `testnet` (default) or `mainnet`. **Mainnet requires ALFA's sign-off** |
| `NEXT_PUBLIC_HL_DATA_NETWORK` | Optional. Market data from another network (e.g. mainnet prices in a demo) |
| `NEXT_PUBLIC_HL_HIP3_DEXES` | HIP-3 dexes to list, e.g. `xyz` (stocks and commodities) |
| `NEXT_PUBLIC_HL_INFO_URL`, `NEXT_PUBLIC_HL_WS_URL` | Optional overrides (local mock, own node) |
| `NEXT_PUBLIC_BUILDER_ADDRESS`, `NEXT_PUBLIC_BUILDER_FEE_TENTHS_BPS` | Builder code. `50` = 0.05%; the perps max is `100`. **Trading is disabled until the address is set.** Hyperliquid only lets users approve a builder that holds ≥ 100 USDC of **perps** account value (Spot doesn't count, so neither does a unified account's balance). Until then users still enable trading and trade, **without the platform fee**; once the builder is funded, the fee step comes back on their next visit (one signature). Use a separate wallet that only collects fees. Orders placed from the builder wallet itself carry no builder fee |
| `NEXT_PUBLIC_ARB_RPC_URL` | Optional Arbitrum RPC for deposits. Defaults to the public RPC (Arbitrum One / Sepolia) |
| `NEXT_PUBLIC_RPC_URLS` | Optional JSON of RPC URLs by chain id for the other deposit networks (mainnet). Defaults to public RPCs |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect project id (free, cloud.reown.com) for mobile wallets via QR code. Add the site's domain to the project's allowlist |
| `NEXT_PUBLIC_RELAY_API_URL` | Optional Relay API URL for cross-chain deposits. Defaults to `https://api.relay.link` |
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `API_PORT`, `API_HOST`, `API_INTERNAL_URL` | API bind address; where Next proxies `/api` in dev |
| `INVITE_ONLY` | `true`: sign-up requires an invite code |
| `SITE_ACCESS_CODE` | Private preview: when set, every page asks for this code first (`/access`, 10 wrong tries per IP per 15 min). Empty = public site |
| `ADMIN_ADDRESSES` | Comma-separated master wallets allowed to use `/api/admin/*` |
| `REWARD_TIERS_JSON` | Optional. Override reward tiers: `[{"name","minVolume","rebatePct","referralPct"}]` |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Phase 3 (X verification) |
| `SEED_DEMO`, `SEED_INVITE_CODES` | Dev seed only. **Never set `SEED_DEMO=true` against production** |

`NEXT_PUBLIC_*` values are compiled into the web bundle at build time. Rebuild the web app after changing them.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web and API with hot reload |
| `pnpm build` | Prisma generate → API bundle (`apps/api/dist`) → Next production build |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Checks. API tests need Postgres and Redis; they use `swellfi_test` and Redis db 15 |
| `pnpm db:migrate` / `pnpm db:deploy` | Create and apply migrations (dev) / apply only (prod) |
| `pnpm db:seed` | Seed invite codes (and demo data if `SEED_DEMO=true`) |
| `pnpm --filter @swellfi/db exec tsx src/seed.ts --purge-demo` | Delete all demo rows |
| `pnpm mock:hl` | Local mock Hyperliquid API + WS on :4100, for offline dev and e2e |

### End-to-end tests (full trading lifecycle, offline)

`apps/web/e2e/mock-hl.mjs` behaves like Hyperliquid for everything the app uses:

- Market data.
- `/exchange` with **the same signature checks as Hyperliquid**: L1 actions must come from an approved agent; user-signed actions from the user.
- Builder-fee approval enforcement, including Hyperliquid's 100 USDC minimum for the builder (`MOCK_HL_BUILDER`, default the first Hardhat/Anvil test address, starts with 100 USDC).
- Order matching with TP/SL triggers.
- Deposits through a mock Arbitrum RPC.

`e2e/trading.spec.ts` drives the real UI with a test wallet:

1. Connect the wallet, then redeem an invite.
2. Deposit (the minimum is checked).
3. Enable trading.
4. Market buy with a TP.
5. The TP fires.
6. Withdraw.

`e2e/feed.spec.ts` covers the activity feed end to end: a trade is picked up by the indexer (run it against the mock, see below), shows as "opened" and "closed", and a second trader likes it, follows, filters and uses Copy trade. `e2e/profile.spec.ts` covers editing the profile and the deposit/withdrawal history. `e2e/tpsl.spec.ts` sets, edits and removes TP/SL on an open position and lets the stop fire. `e2e/close.spec.ts` closes a position in three steps: part at market, part with a resting limit, the rest with a limit already through the market. `e2e/builder.spec.ts` trades from the builder wallet (no fee to itself); its unfunded-builder tests (users still trade without the fee; the fee comes back once it's funded; Hyperliquid refusing after a stale balance read) empty the builder's balance, so it only runs with `E2E_BUILDER_BALANCE=1` and on its own (`pnpm --filter @swellfi/web e2e builder.spec.ts`).

`e2e/deposit-relay.spec.ts` covers deposits from other networks through Relay (the Relay API and the Base RPC are mocked in the browser). It needs a mainnet build (`NEXT_PUBLIC_HL_NETWORK=mainnet`), the mock in mainnet mode (`MOCK_HL_NETWORK=mainnet`), and `E2E_NETWORK=mainnet`; otherwise it is skipped.

```bash
pnpm mock:hl &
NEXT_PUBLIC_HL_INFO_URL=http://localhost:4100/info NEXT_PUBLIC_HL_WS_URL=ws://localhost:4100/ws \
NEXT_PUBLIC_ARB_RPC_URL=http://localhost:4100/rpc NEXT_PUBLIC_BUILDER_ADDRESS=0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 \
  pnpm --filter @swellfi/web build
pnpm --filter @swellfi/api build && pnpm start &   # API + web
(cd apps/api && INDEXER_RPM=600 node --env-file=../../.env dist/indexer-main.js &)   # indexer, for feed.spec
pnpm --filter @swellfi/web e2e                     # Playwright (set CHROMIUM_PATH if needed)
```

The waitlist test hits the real 5/minute rate limit if the suite runs several times within a minute.

### Admin: approving the waitlist

```bash
TOKEN=<Privy access token of an admin>
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/admin/waitlist
curl -X POST -H "Authorization: Bearer $TOKEN" https://<host>/api/admin/waitlist/<id>/approve   # → invite code to email
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"count":10,"maxUses":1}' https://<host>/api/admin/invites
```

## How trading works (Phase 2)

| Step | Signed by | What happens |
|---|---|---|
| Deposit | Master wallet (Privy embedded or external) | USDC `transfer` on Arbitrum to Hyperliquid's Bridge2. The modal enforces the **5 USDC minimum**, shows the tx, then polls until Hyperliquid credits it |
| Deposit (other networks, mainnet) | Master wallet, on the origin chain | USDC, USDT or the native coin on Arbitrum, Ethereum, Base, Optimism, BNB Chain, Polygon or Avalanche, routed by [Relay](https://relay.link) into the user's own HyperCore perps USDC (Relay chain 1337). The quote is shown first and checked before signing: it must end as perps USDC on HyperCore, with the user as recipient, from the selected token |
| Enable trading | Master wallet | `approveAgent`: a fresh agent key, generated in the browser, named `swellfi`, valid 90 days. Then `approveBuilderFee` for the configured builder at `NEXT_PUBLIC_BUILDER_FEE_TENTHS_BPS` |
| Orders, cancels, leverage, close, position TP/SL | **Agent key** (no wallet popup) | `order` with the builder object on every order (except from the builder wallet itself, and while the builder is under 100 USDC and the user hasn't approved it); `cancel`; `updateLeverage` (cross/isolated) before an order when it changed; close = reduce-only IOC at market or a reduce-only GTC limit, for all or part of the position (whole lots). For HIP-3 markets, collateral moves to that dex with `agentSendAsset` (same user only) |
| Withdraw | Master wallet | `withdraw3` to the user's own address. The 1 USDC Hyperliquid fee is shown before signing |

- The agent key lives only in the browser. It is stored in IndexedDB, encrypted with a non-extractable AES-GCM key, and never sent to our API. It can trade but can't withdraw or transfer to anyone else.
- Positions, open orders, order history, funding history and the Trading Account card come straight from Hyperliquid: `clearinghouseState` per dex, `frontendOpenOrders`, `historicalOrders`, `userFunding`, `userFills`. Data is polled and refreshed instantly on WS `orderUpdates` / `userFills`.
- Builder revenue: each fill carries `builderFee` (already included in `fee`). Writing it to `RewardLedger` is still to do.

## Indexer and activity feed

`apps/api/src/indexer` (PM2 app `swellfi-indexer`) is the only writer of `Fill`, trade `Activity` and `DailyStat`:

- For every registered (non-demo) user it calls `userFillsByTime` from the stored cursor (30 days on the first run, pages of 2000), stores the fills and rebuilds one feed event per order and side: `fill:<userId>:<oid>:open|close`. Partial fills of an order converge to one event; a flip (`Long > Short`) is a close plus an open.
- A close shows net PnL (closed PnL minus fees) and the entry price derived from it (`entry = exit ∓ closedPnl / size`). Spot fills are ignored. Leverage comes from `clearinghouseState` (remembered from the open for the close).
- `DailyStat` per UTC day: PnL, volume, orders, closed orders, wins; equity from `clearinghouseState` (all dexes) and, on the first run, the `portfolio` month history. Funding isn't in PnL yet.
- Scheduling: an account with new fills is polled again after 20 s; quiet ones back off 5 s, 15 s, 30 s, 1, 2, 4, 8 and at most 15 min. All requests share one token bucket (`INDEXER_RPM`, default 40/min), and a 429 pauses everything for a minute.
- `POST /api/me/sync` (called by the web app when an order succeeds or a fill arrives) makes the indexer look at that account now. Limited per account: the first call in 10 s polls now, later ones are deferred to the window's end, never dropped. A poll that finishes never pushes back a sync that arrived while it ran.
- Feed API: `GET /api/activity?scope=global|following&kind=all|trades|open|close`, likes (`POST/DELETE /api/activity/:id/like`), follows (`POST/DELETE /api/users/:id/follow`), `GET /api/news` (RSS, cached 10 min). Private accounts (`isPublic: false`, set in Edit profile) are left out of the feed and rankings.
- "Copy trade" only fills in the order panel (market, side, leverage). The user still picks the size and confirms.

## Testnet runbook (Phase 2 acceptance)

1. Fill in `.env` and rebuild the web app:
   - `NEXT_PUBLIC_HL_NETWORK=testnet`
   - `NEXT_PUBLIC_HL_DATA_NETWORK` empty
   - `NEXT_PUBLIC_BUILDER_ADDRESS`
   - Privy keys are optional; MetaMask/Rabby work without them.
2. Fund the builder wallet with ≥ 100 USDC perps value on testnet.
3. Prepare a test user wallet. The **testnet faucet only pays addresses that have made a mainnet deposit**. Claim 1,000 mock USDC at https://app.hyperliquid-testnet.xyz/drip, or bridge test USDC on Arbitrum Sepolia, and keep a little Sepolia ETH for gas.
4. Log in, redeem an invite, then **Deposit** (≥ 5 USDC) → **Enable trading** (two signatures).
5. Run the trade lifecycle:
   1. Market buy BTC with a TP a little above the price.
   2. Watch the position and the TP order (Positions → TP / SL; Open Orders).
   3. When the TP triggers, the position closes and it shows in Order History.
6. Check the builder fee: `curl -s https://api.hyperliquid-testnet.xyz/info -d '{"type":"userFills","user":"<addr>"}' -H 'content-type: application/json'` shows `builderFee` on the fills.
7. **Withdraw** a few USDC. It arrives on Arbitrum Sepolia minus 1 USDC.

## Deploying to the VPS (Hostinger, Ubuntu)

### One-time server setup

DNS first: an `A` record for `swellfi.xyz` and a `CNAME` (or `A`) for `www` pointing at the VPS. Then, as root on a fresh Ubuntu 24.04 server:

```bash
curl -fsSL https://raw.githubusercontent.com/fourtisf/swellfi/main/deploy/bootstrap.sh -o bootstrap.sh
EMAIL=you@example.com bash bootstrap.sh
# optional: BUILDER=0x… ADMIN=0x…,0x… BRANCH=<branch>
```

`deploy/bootstrap.sh` is safe to re-run. It:

- installs Node 22, pnpm, PM2, Postgres, Redis, Nginx and certbot, and adds 2 GB swap on small machines;
- creates a `swellfi` system user that owns `/srv/swellfi` and runs the apps;
- writes `/srv/swellfi/.env` once (chmod 600) with a random `SESSION_SECRET`, a random database password, `SEED_DEMO=false`, testnet, and fresh invite codes (the repo's codes are public). Re-runs never overwrite it;
- migrates, seeds the invite codes, builds, and starts both apps under PM2 with boot persistence;
- gets a Let's Encrypt certificate (webroot, auto-renewing), installs `deploy/nginx/swellfi.conf`, and enables `ufw` for SSH, 80 and 443.

`NEXT_PUBLIC_*` values are baked in at build time: after editing them in `.env`, run the update below.

### Nginx

`deploy/nginx/swellfi.conf` routes:

- `/api/` → API on :4000
- `/ws` → API, with WebSocket upgrade headers and a 1 h read timeout
- everything else → Next on :3000

It redirects HTTP to HTTPS on the same host and then `www` to `https://swellfi.xyz`, sends an HSTS header with `preload` (submit the domain at https://hstspreload.org once you're sure every subdomain will stay HTTPS), and caches `/_next/static`. The bootstrap installs it after the certificate exists; to update it later, copy it to `/etc/nginx/sites-available/swellfi` and run `nginx -t && systemctl reload nginx`.

### Subsequent deploys

```bash
sudo -u swellfi -H bash -lc 'cd /srv/swellfi && ./deploy/deploy.sh'   # pull → install → migrate → build → pm2 reload → health check
```

### PM2

`deploy/ecosystem.config.cjs` runs three processes:

- `swellfi-api`: `node --env-file=.env apps/api/dist/index.js`
- `swellfi-indexer`: `node --env-file=.env apps/api/dist/indexer-main.js` (one instance only)
- `swellfi-web`: `next start` on 127.0.0.1:3000

`deploy.sh` uses `pm2 startOrReload`, so apps added to the file start on the next deploy.

Useful commands: `pm2 logs`, `pm2 status`, `pm2 reload all`.

## Security model

- **Non-custodial.**
  - The server never holds user funds or any private key.
  - The trading agent key is generated and encrypted in the browser. It can place and cancel orders but cannot withdraw. Encryption at rest protects against storage exfiltration, not XSS, so the CSP must be enforced before mainnet (see NOTES.md).
  - Withdrawals are signed by the user's master wallet.
- **API.**
  - Every signed-in route verifies the Privy access token.
  - Invite redemption checks that the submitted wallet is linked to that Privy user.
  - Inputs are validated with zod.
  - Global and per-route rate limits are stored in Redis.
  - Helmet headers are set.
- **Web.**
  - Security headers are set.
  - A CSP ships in report-only mode until the Privy and WalletConnect host list is confirmed. See NOTES.md.
