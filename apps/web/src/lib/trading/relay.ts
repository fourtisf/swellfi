"use client";

import { adaptViemWallet, convertViemChainToRelayChain, createClient, getClient, MAINNET_RELAY_API, type AdaptedWallet, type Execute, type ProgressData } from "@relayprotocol/relay-sdk";
import { decodeFunctionData, erc20Abi, formatUnits, parseUnits, type WalletClient } from "viem";
import { BRAND } from "../env";
import { DEPOSIT_CHAINS, NATIVE, publicClientFor, rpcUrl, type DepositChain, type DepositToken } from "./chains";

// Deposits from any supported chain/token into the user's own Hyperliquid perps account, routed by
// Relay (https://relay.link). Relay's chain id for HyperCore is 1337, and perps USDC there is the
// 16-byte zero id (8 decimals); the recipient is the user's own address.
export const HYPERCORE_CHAIN_ID = 1337;
export const HYPERCORE_USDC = "0x00000000000000000000000000000000";

let ready = false;
function client() {
  if (!ready) {
    createClient({
      baseApiUrl: process.env.NEXT_PUBLIC_RELAY_API_URL || MAINNET_RELAY_API,
      source: "swellfi.xyz",
      chains: DEPOSIT_CHAINS.map((d) => {
        const rc = convertViemChainToRelayChain(d.chain);
        return { ...rc, httpRpcUrl: rpcUrl(d.chain) };
      }),
    });
    ready = true;
  }
  return getClient();
}

/** Balance of `token` for `user` on `chain`, in base units. */
export async function tokenBalance(chain: DepositChain, token: DepositToken, user: `0x${string}`): Promise<bigint> {
  const pc = publicClientFor(chain.chain);
  if (token.address === NATIVE) return pc.getBalance({ address: user });
  return pc.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [user] });
}

/** Refuse to quote a token whose on-chain decimals differ from the registry (a wrong address). */
async function checkDecimals(chain: DepositChain, token: DepositToken) {
  if (token.address === NATIVE) return;
  const d = await publicClientFor(chain.chain).readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" });
  if (Number(d) !== token.decimals) throw new Error(`${token.symbol} on ${chain.name} doesn't match the expected contract`);
}

export interface DepositQuote {
  raw: Execute;
  receiveUsdc: number;
  sendUsd: number | null;
  feesUsd: number | null;
  seconds: number | null;
  guard: Guard;
}

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// ---------- Transaction guard ----------
// The transactions to sign come from Relay's API. Whatever it returns (a bug, a compromised API or a
// tampered response), the user must never sign more than "send `amount` of the selected token":
// - only plain transactions on the origin chain, from the user (no off-chain signatures);
// - on the selected token, only approve/transfer, each capped at the amount (no unlimited approval);
// - no approve/transfer/permit-style call on any other contract (other tokens/NFTs stay untouched);
// - native coin sent only when it is the selected token, in total at most the amount.

interface Guard {
  chainId: number;
  user: `0x${string}`;
  token: DepositToken;
  amount: bigint;
}
type TxData = { from?: string; to?: string; data?: string; value?: string | number; chainId?: number };

const SEL = { approve: "0x095ea7b3", transfer: "0xa9059cbb" };
// Calls that move or authorize assets: transfer, transferFrom, approve, increaseAllowance, permit
// (EIP-2612 and DAI), setApprovalForAll, ERC-721/1155 safeTransferFrom, Permit2 approve.
const ASSET_CALLS = new Set(["0xa9059cbb", "0x23b872dd", "0x095ea7b3", "0x39509351", "0xd505accf", "0x8fcbaf0c", "0xa22cb465", "0x42842e0e", "0xb88d4fde", "0xf242432a", "0x2eb2c2d6", "0x87517c45"]);

class UnsafeRoute extends Error {
  constructor(why: string) {
    super(`Blocked an unsafe deposit transaction from Relay (${why}). Nothing was signed.`);
  }
}

function checkTx(g: Guard, chainId: number, d: TxData | undefined, spent: { out: bigint }) {
  if (!d?.to || !/^0x[0-9a-fA-F]{40}$/.test(d.to)) throw new UnsafeRoute("no target contract");
  if (chainId !== g.chainId || (d.chainId != null && Number(d.chainId) !== g.chainId)) throw new UnsafeRoute("wrong network");
  if (d.from && !same(d.from, g.user)) throw new UnsafeRoute("different sender");
  let value: bigint;
  try {
    value = BigInt(d.value ?? 0);
  } catch {
    throw new UnsafeRoute("bad value");
  }
  const data = (d.data ?? "0x").toLowerCase() as `0x${string}`;
  const sel = data.slice(0, 10);
  const nativeIn = g.token.address === NATIVE;
  if (nativeIn) {
    spent.out += value;
    if (spent.out > g.amount) throw new UnsafeRoute("sends more than your amount");
  } else if (value !== 0n) throw new UnsafeRoute("sends native coin");
  if (!nativeIn && same(d.to, g.token.address)) {
    if (sel !== SEL.approve && sel !== SEL.transfer) throw new UnsafeRoute("unexpected token call");
    let amt: bigint;
    try {
      amt = decodeFunctionData({ abi: erc20Abi, data }).args![1] as bigint;
    } catch {
      throw new UnsafeRoute("unreadable token call");
    }
    if (sel === SEL.transfer) {
      spent.out += amt;
      if (spent.out > g.amount) throw new UnsafeRoute("sends more than your amount");
    } else if (amt > g.amount) throw new UnsafeRoute("approves more than your amount");
  } else if (ASSET_CALLS.has(sel)) throw new UnsafeRoute("touches another token");
}

/** Every step of a quote must pass the guard before anything is shown or signed. */
function checkSteps(g: Guard, steps: Execute["steps"]) {
  if (!steps?.length) throw new UnsafeRoute("empty route");
  const spent = { out: 0n };
  for (const st of steps) {
    if (st.kind !== "transaction") throw new UnsafeRoute(`"${st.kind}" step`);
    for (const it of st.items ?? []) checkTx(g, Number(it.data?.chainId ?? g.chainId), it.data, spent);
  }
}

/** Wraps the wallet so each transaction is re-checked at the moment it is sent. */
function guardWallet(w: AdaptedWallet, g: Guard): AdaptedWallet {
  const spent = { out: 0n };
  const sender = async () => {
    if (!same(await w.address(), g.user)) throw new UnsafeRoute("wallet account changed");
  };
  return {
    ...w,
    handleSignMessageStep: async () => {
      throw new UnsafeRoute("signature request");
    },
    handleSendTransactionStep: async (chainId, item, step) => {
      await sender();
      checkTx(g, chainId, item.data, spent);
      return w.handleSendTransactionStep(chainId, item, step);
    },
    handleBatchTransactionStep: w.handleBatchTransactionStep
      ? async (chainId, items, step) => {
          await sender();
          for (const it of items) checkTx(g, chainId, it.data, spent);
          return w.handleBatchTransactionStep!(chainId, items, step);
        }
      : undefined,
  };
}

/** Quote `amount` of `token` on `chain` into the user's Hyperliquid perps USDC. */
export async function quoteDeposit(chain: DepositChain, token: DepositToken, amount: string, user: `0x${string}`): Promise<DepositQuote> {
  await checkDecimals(chain, token);
  const units = parseUnits(amount, token.decimals);
  if (units <= 0n) throw new Error("Enter an amount");
  const raw = await client().actions.getQuote({
    chainId: chain.chain.id,
    currency: token.address,
    toChainId: HYPERCORE_CHAIN_ID,
    toCurrency: HYPERCORE_USDC,
    amount: units.toString(),
    tradeType: "EXACT_INPUT",
    user,
    recipient: user,
  });
  const d = raw.details;
  // The funds must land as perps USDC on HyperCore, in this user's own account, from exactly the
  // selected token and amount. Every field must be present: anything missing is refused.
  const out = d?.currencyOut?.currency;
  const inn = d?.currencyIn?.currency;
  if (!d || !out || out.chainId !== HYPERCORE_CHAIN_ID || !same(out.address, HYPERCORE_USDC)) {
    throw new Error("Relay returned a route that doesn't end in your Hyperliquid account");
  }
  if (!same(d.recipient, user)) throw new Error("Relay returned a different recipient");
  if (d.sender && !same(d.sender, user)) throw new Error("Relay returned a different sender");
  if (!inn || inn.chainId !== chain.chain.id || !same(inn.address, token.address)) throw new Error("Relay returned a route from a different token");
  if (d.currencyIn?.amount != null && BigInt(d.currencyIn.amount) > units) throw new Error("Relay returned a larger amount than you entered");
  const guard: Guard = { chainId: chain.chain.id, user, token, amount: units };
  checkSteps(guard, raw.steps);
  const receive = num(d.currencyOut?.amountFormatted) ?? (d.currencyOut?.amount ? Number(formatUnits(BigInt(d.currencyOut.amount), out.decimals ?? 8)) : null);
  if (receive == null || receive <= 0) throw new Error("Relay couldn't price this deposit");
  const f = raw.fees;
  const fees = [f?.gas, f?.relayer, f?.app].map((x) => num(x?.amountUsd)).filter((x): x is number => x != null);
  return { raw, receiveUsdc: receive, sendUsd: num(d.currencyIn?.amountUsd), feesUsd: fees.length ? fees.reduce((a, b) => a + b, 0) : null, seconds: num(d.timeEstimate), guard };
}

export type RelayStage = "sign" | "confirming" | "delivering";

/** Run a quote: wallet approvals/transfers on the origin chain, then Relay fills on Hyperliquid. */
export async function executeDeposit(q: DepositQuote, wallet: WalletClient, onStage: (s: RelayStage, originTxHash?: string) => void) {
  const origin = q.raw.details?.currencyIn?.currency?.chainId;
  const rank: Record<RelayStage, number> = { sign: 0, confirming: 1, delivering: 2 };
  let stage: RelayStage = "sign";
  let hash: string | undefined;
  const { data } = await client().actions.execute({
    quote: q.raw,
    wallet: guardWallet(adaptViemWallet(wallet), q.guard),
    onProgress: (p: ProgressData) => {
      // Once Relay fills, txHashes switch to the HyperCore fill; keep the origin-chain deposit tx.
      const item = p.currentStepItem;
      const tx = [...(item?.internalTxHashes ?? []), ...(p.txHashes ?? [])].find((h) => origin == null || h.chainId === origin);
      if (tx && !hash) hash = tx.txHash;
      const st = item?.progressState;
      const check = item?.checkStatus;
      const next: RelayStage =
        st === "validating" || st === "complete" || check === "pending" || check === "submitted" || check === "success" ? "delivering" : st === "confirming" || hash ? "confirming" : "sign";
      // Progress only moves forward (an approval step can precede the deposit step).
      if (rank[next] > rank[stage]) stage = next;
      onStage(stage, hash);
    },
  });
  if (data.refunded) throw new Error(`Relay couldn't complete the deposit and refunded it to your wallet on the origin network. Nothing reached ${BRAND}.`);
  const failed = data.steps.flatMap((s) => s.items).find((i) => i.checkStatus === "failure" || i.checkStatus === "refund");
  if (failed) throw new Error("Relay reported the deposit as failed or refunded. Check the transaction on the origin network.");
  return { hash };
}

/** Relay stopped polling a deposit that was already sent: it may still complete. */
export const isRelayTimeout = (e: unknown) => /is pending after \d+ attempt|solver status check .* after \d+ attempt/i.test(e instanceof Error ? e.message : String(e));

/** Human message from Relay errors (quote too small, no route, wallet rejection). */
export function relayErr(e: unknown): string {
  if (e instanceof UnsafeRoute) return e.message;
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e instanceof Error ? e.message : String(e));
  if (/user rejected|denied|rejected the request/i.test(m)) return "Signature request was cancelled";
  if (/amount.*(too|low|small)|minimum/i.test(m)) return "This amount is below Relay's minimum for this route. Try a larger amount.";
  if (/no.*route|unsupported/i.test(m)) return "Relay has no route for this token right now. Try USDC or another network.";
  return m.replace(/^.*?Error: /, "").slice(0, 220);
}
