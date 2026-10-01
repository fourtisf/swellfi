# NOTES — Hyperliquid / Privy verification

Checked on **2026-10-01** against:

- The official Hyperliquid GitBook docs. They were read via a mirror of the GitBook `.md` export, because the build sandbox's network blocks `hyperliquid.gitbook.io` and `api.hyperliquid.xyz`.
- The official `hyperliquid-python-sdk` 0.24.0.
- `@nktkas/hyperliquid` 0.33.3.
- `@privy-io/react-auth` 3.46.0, `@privy-io/node` 0.35.0, `@privy-io/server-auth` 1.32.5.

**Re-check every item marked ⚠️ against the live docs before Phase 2 goes to mainnet.**

## Differences from HANDOFF.md

| HANDOFF says | Current reality | What we do |
|---|---|---|
| WS `webData2` for per-user state | **Replaced by `webData3`**, which carries only user/agent state, not positions. `webData2` is deprecated; the TS SDK removed it. | Phase 2 subscribes to `clearinghouseState` and `openOrders` (both take `dex`), or `allDexsClearinghouseState`. `packages/hl` no longer lists `webData2`. |
| Server verifies Privy with `@privy-io/server-auth` (implied) | `@privy-io/server-auth` is **deprecated on npm** in favour of `@privy-io/node`. | API uses `@privy-io/node`: `privy.utils().auth().verifyAccessToken(token)` and `privy.users()._get(id)`. |
| Bridge deposit (USDC on Arbitrum → Bridge2) | The docs now call the legacy bridge **deprecated; CCTP is preferred**. Bridge2 still works. | ⚠️ Phase 2: decide Bridge2 vs CCTP. CCTP addresses, fees and minimums are **not verified**. |
| `dex: "xyz"` for stocks/commodities | Correct on mainnet (`xyz:NVDA`, `xyz:TSLA`, `xyz:XYZ100`…). ⚠️ **Unverified on testnet**: the docs' testnet example uses dex `"test"`. | Dexes are configurable (`NEXT_PUBLIC_HL_HIP3_DEXES`). The loader asks `perpDexs` and silently skips a dex the network doesn't have. |
| Agent "cannot withdraw" | True in effect. `withdraw3`, `usdSend`, `usdClassTransfer`, `sendAsset`, `approveAgent` and `approveBuilderFee` are **user-signed** (master wallet only). An agent *can* sign `agentSendAsset`, which only moves collateral between the user's own dexs/spot (destination = source user). | Matches our design. HIP-3 trading needs collateral on that dex: Phase 2 uses `agentSendAsset` or account abstraction. |
| Builder fee `f: 50` = 0.05% (tenths of a bp) | **Correct.** Max is 0.1% on perps (`f ≤ 100`) and 1% on spot. | `NEXT_PUBLIC_BUILDER_FEE_TENTHS_BPS=50`. |

## Verified values

### Endpoints

| | REST | WS |
|---|---|---|
| Mainnet | `https://api.hyperliquid.xyz` (`/info`, `/exchange`) | `wss://api.hyperliquid.xyz/ws` |
| Testnet | `https://api.hyperliquid-testnet.xyz` | `wss://api.hyperliquid-testnet.xyz/ws` |

Info requests used:

- `metaAndAssetCtxs {dex?}`
- `perpDexs`: element `[0]` is `null`, which is the main dex.
- `allMids {dex?}`
- `l2Book {coin}`: max 20 levels per side.
- `candleSnapshot {req:{coin, interval, startTime, endTime}}`: only the latest 5000 candles; responses are paged at ~500.

Phase 2 adds `clearinghouseState {user, dex?}`, `openOrders`, `frontendOpenOrders`, `userFills` (all dexes, max 2000), `userFillsByTime`, `userFunding`, `historicalOrders`, `portfolio`, `maxBuilderFee {user, builder}` and `extraAgents`.

### WebSocket

- Subscribe: `{"method":"subscribe","subscription":{…}}`. The ack arrives on channel `subscriptionResponse`.
- The `userEvents` subscription delivers on channel **`user`**. `packages/hl` handles this.
- The server drops connections idle for 60 s. We send `{"method":"ping"}` every 30 s; the reply is channel `pong`.
- Per-IP limits:
  - 10 connections
  - 30 new connections per minute
  - 1000 subscriptions
  - 10 unique users across user subscriptions
  - 2000 messages per minute

  The web app uses **one shared socket per tab** with reference-counted subscriptions.

### Asset ids

| Market | Asset id |
|---|---|
| Main-dex perp | index in `meta.universe` |
| Spot | `10000 + spot index` |
| **HIP-3 perp** | **`100000 + perpDexIndex * 10000 + indexInMeta`**, where `perpDexIndex` is the position in `perpDexs` (0 = main dex) |

Implemented in `packages/hl/src/markets.ts` and unit-tested.

### Signing (Phase 2)

**L1 actions** are signed by the agent:

- `order`, `cancel`, `cancelByCloid`, `modify`, `batchModify`
- `updateLeverage`, `updateIsolatedMargin`
- `scheduleCancel`, `twapOrder`, `agentSendAsset`

They use EIP-712 domain `{name:"Exchange", version:"1", chainId:1337, verifyingContract:0x0}` with type `Agent{source, connectionId}`. `source` is `"a"` on mainnet and `"b"` on testnet.

**User-signed actions** are signed by the master wallet:

- `approveAgent`, `approveBuilderFee`
- `withdraw3`, `usdSend`, `usdClassTransfer`, `sendAsset`

They use domain `{name:"HyperliquidSignTransaction", version:"1", chainId:signatureChainId, verifyingContract:0x0}` plus `hyperliquidChain: "Mainnet" | "Testnet"`.

- ⚠️ **Set `signatureChainId` explicitly** (e.g. `0xa4b1`, Arbitrum). Wallets reject typed data whose chainId differs from their active chain, and Privy's `toViemAccount` defaults to `0x1`.

**Order wire format:** `{a, b, p, s, r, t:{limit:{tif:"Gtc"|"Ioc"|"Alo"}} | {trigger:{isMarket, triggerPx, tpsl}}, c?}`

- `grouping`: `na` | `normalTpsl` | `positionTpsl`
- `builder: {b, f}`. The builder address must be lowercase.

**Rounding:**

- Price: at most 5 significant figures and at most `6 − szDecimals` decimals (perps, including HIP-3).
- Size: rounded to `szDecimals`.
- **Minimum order value is $10.**

The SDK exports `formatPrice` / `formatSize`.

### Builder fee

- `approveBuilderFee.maxFeeRate` is a **percent string** such as `"0.05%"`. Use `tenthsBpsToPercentString(50)` in `packages/hl`.
- The builder wallet needs **≥ 100 USDC perps account value** and the "standard" account abstraction mode.
- A user can have at most 10 active builder approvals.
- In fills, `builderFee` is an optional string, absent when zero, and **already included in `fee`**. The indexer must not double-count it.
- Builders claim fees through the referral claim. There is also a daily CSV export at `stats-data.hyperliquid.xyz/Mainnet/builder_fills/{addr}/{YYYYMMDD}.csv.lz4`.

### Agent wallets

- Each account gets 1 unnamed agent plus up to 3 named agents.
- Expiry: append `valid_until <ms>` to `agentName` (max 180 days; requires a name).
- Approving a new agent under the same name replaces the old one, and nonce state can be pruned. **Never reuse an agent address.**
- Agents are pruned when the master account has no funds.
- Always query state with the **master** address.

### Bridge (Arbitrum) ⚠️

| | Mainnet | Testnet (Arbitrum Sepolia) |
|---|---|---|
| Bridge2 | `0x2df1c51e09aecf9cacb7bc98cb1742757f163df7` | `0x08cfc1B6b2dCF36A1480b99353A354AA8AC56f89` |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC) | `0x1baAbB04529D43a73232B713C0FE471f7c7334d5` (USDC2) |

- **Deposits below 5 USDC are lost.** The UI must enforce the minimum.
- Deposits are credited in < 1 min.
- `withdraw3` fee is 1 USDC ("at time of writing"); funds arrive in ~3–5 min.

### Rate limits

**REST:** 1200 weight per minute per IP.

| Request | Weight |
|---|---|
| Exchange actions | `1 + ⌊n/40⌋` |
| `l2Book`, `allMids`, `clearinghouseState` | 2 |
| `userRole` | 60 |
| Most other info requests | 20 |

- `userFills` and similar requests add +1 per 20 items returned.
- `candleSnapshot` adds +1 per 60 items.

The indexer (Phase 3) must batch requests and back off.

### Testnet faucet

- 1,000 mock USDC at `app.hyperliquid-testnet.xyz/drip`.
- **Requires a prior mainnet deposit from the same address.** Test wallets need that before Phase 2 testing.

### @nktkas/hyperliquid (Phase 2 signing)

- Version 0.33.3, MIT, actively maintained (last release 2026-08-02), listed by Hyperliquid as a community SDK.
- **Requires Node ≥ 22.12**, so `engines` is set accordingly.
- It is pre-1.0: pin the exact version.
- Supports HIP-3 (`dex` params, `SymbolConverter`) and viem accounts.

### Privy

- `@privy-io/react-auth` 3.46.0 supports React 18. We use:
  - `embeddedWallets.ethereum.createOnLogin: "users-without-wallets"`
  - `appearance.walletList` with `"detected_ethereum_wallets"`. `rabby_wallet` is deprecated; Rabby shows up as a detected wallet.
- `login()` cannot deep-link a single wallet. The prototype's MetaMask, Rabby and WalletConnect buttons therefore all open Privy's wallet list.
- The server verifies access tokens locally when `PRIVY_VERIFICATION_KEY` is set; otherwise it uses Privy's cached JWKS.

## Phase 2 implementation decisions

- **Named agent.**
  - The agent is approved as `tideline valid_until <now+90d>`; the SDK excludes the suffix from the 16-char limit. `extraAgents` is used to check it's still live.
  - Each (re)approval uses a **new** key, so agent addresses are never reused.
  - Approving from a second device replaces the first device's agent.
- **`signatureChainId`.** Pinned to the Arbitrum chain the master wallet is switched to: `0xa4b1` on mainnet, `0x66eee` on testnet. Privy is configured with `supportedChains: [arbitrum, arbitrumSepolia]`.
- **Unified / portfolio-margin accounts.** `userAbstraction` is checked; for those modes, available balance comes from `spotClearinghouseState` and no HIP-3 collateral transfer is attempted.
- **HIP-3 collateral (standard accounts).** Before a HIP-3 order, if that dex's withdrawable is below the margin needed, the shortfall moves from the main dex with **agent-signed `agentSendAsset`**. This works only to the same user. The token is `name:tokenId` from `meta({dex}).collateralToken` → `spotMeta.tokens`.
- **Leverage.** `updateLeverage` is sent before an order only when the panel's leverage or margin mode differs from what was last set in this session.
- **Trading guard.** Trading is disabled unless market data and orders use the same network: asset ids and prices differ between networks.

## Not verified (needs a check with network access)

1. Whether the `xyz` dex exists on testnet, and its collateral token.
2. CCTP deposit and withdraw details.
3. The exact Privy, WalletConnect and Coinbase host list for a strict CSP. **Enforce the CSP before mainnet**: the agent key is only as safe as the page is from XSS. The CSP ships **report-only** for now (`apps/web/next.config.mjs`).
4. TradingView Advanced Charts licence. Until it's approved we use `lightweight-charts` 4.2, whose Apache-2.0 licence requires the TradingView attribution logo shown on the chart.
