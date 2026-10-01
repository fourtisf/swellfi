# Prompt for Claude Code (paste this as the first message)

You are building the production version of **Tideline**, a non-custodial Hyperliquid perpetuals trading platform with a social layer (rankings, feed, live activity, global chat), modeled on app.rayze.io.

Files in this folder:
- `HANDOFF.md` — full spec: stack, architecture, Hyperliquid integration, data model, phases, acceptance criteria. Read it completely first.
- `tideline-prototype.html` — single-file working prototype. It is the **UI source of truth**. Open it, study every view (`#v-home`, `#v-trade`, `#v-feed`, `#v-rankings`, `#v-funds`, `#v-rewards`) and the modals, and port the design pixel-close. Reuse its real market-data logic (Hyperliquid info API + WebSocket). Its order engine and social data are simulated and must be replaced.

Rules:
1. Use the house stack: Next.js 14 (App Router, TypeScript), Fastify, Prisma + PostgreSQL, Redis, deployed with PM2 + Nginx on a Hostinger VPS. Monorepo with pnpm workspaces as described in HANDOFF.md.
2. Before writing any Hyperliquid code, read the current official Hyperliquid API docs and confirm endpoints, signing (L1 actions vs user-signed actions), builder fee units/limits, bridge minimum deposit, and asset IDs for HIP-3 markets. Note any differences from HANDOFF.md in `NOTES.md`.
3. Everything trading-related runs on **Hyperliquid testnet** until I explicitly approve mainnet. Network is controlled by `NEXT_PUBLIC_HL_NETWORK`.
4. Non-custodial: private keys never touch our server. The agent key can trade but never withdraw. Withdrawals are signed by the user's master wallet.
5. Every order must include our builder fee object from env config.
6. Use Decimal for money, zod for input validation, rate limits on all routes.
7. Work phase by phase (HANDOFF.md §6). Start with **Phase 1**, then **Phase 2**. At the end of each phase: list what was built, how to run it locally, how to deploy it, and what remains. Stop and ask me before starting the next phase.
8. Keep the dark Rayze-style design from the prototype (no light backgrounds, no black-and-gold).
9. Write a `README.md` with setup steps (env vars, DB migrate, seed, dev, build, PM2 ecosystem file, Nginx config with WebSocket proxying).

Start by: reading both files, writing a short implementation plan for Phase 1 and Phase 2 (folders, packages, key modules), then scaffold the monorepo.
