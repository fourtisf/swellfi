"use client";

import { adaptViemWallet, convertViemChainToRelayChain, createClient, getClient, MAINNET_RELAY_API, type Execute, type ProgressData } from "@relayprotocol/relay-sdk";
import { erc20Abi, formatUnits, parseUnits, type WalletClient } from "viem";
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
}

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const same = (a?: string, b?: string) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Quote `amount` of `token` on `chain` into the user's Hyperliquid perps USDC. */
export async function quoteDeposit(chain: DepositChain, token: DepositToken, amount: string, user: `0x${string}`): Promise<DepositQuote> {
  await checkDecimals(chain, token);
  const raw = await client().actions.getQuote({
    chainId: chain.chain.id,
    currency: token.address,
    toChainId: HYPERCORE_CHAIN_ID,
    toCurrency: HYPERCORE_USDC,
    amount: parseUnits(amount, token.decimals).toString(),
    tradeType: "EXACT_INPUT",
    user,
    recipient: user,
  });
  const d = raw.details;
  // The funds must land as perps USDC on HyperCore, in this user's own account, from this exact token.
  const out = d?.currencyOut?.currency;
  const inn = d?.currencyIn?.currency;
  if (!d || !out || (out.chainId != null && out.chainId !== HYPERCORE_CHAIN_ID) || (out.address != null && !same(out.address, HYPERCORE_USDC))) {
    throw new Error("Relay returned a route that doesn't end in your Hyperliquid account");
  }
  if (d.recipient && !same(d.recipient, user)) throw new Error("Relay returned a different recipient");
  if (inn && ((inn.chainId != null && inn.chainId !== chain.chain.id) || (inn.address != null && !same(inn.address, token.address)))) {
    throw new Error("Relay returned a route from a different token");
  }
  const receive = num(d.currencyOut?.amountFormatted) ?? (d.currencyOut?.amount ? Number(formatUnits(BigInt(d.currencyOut.amount), out.decimals ?? 8)) : null);
  if (receive == null || receive <= 0) throw new Error("Relay couldn't price this deposit");
  const f = raw.fees;
  const fees = [f?.gas, f?.relayer, f?.app].map((x) => num(x?.amountUsd)).filter((x): x is number => x != null);
  return { raw, receiveUsdc: receive, sendUsd: num(d.currencyIn?.amountUsd), feesUsd: fees.length ? fees.reduce((a, b) => a + b, 0) : null, seconds: num(d.timeEstimate) };
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
    wallet: adaptViemWallet(wallet),
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
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (e instanceof Error ? e.message : String(e));
  if (/user rejected|denied|rejected the request/i.test(m)) return "Signature request was cancelled";
  if (/amount.*(too|low|small)|minimum/i.test(m)) return "This amount is below Relay's minimum for this route. Try a larger amount.";
  if (/no.*route|unsupported/i.test(m)) return "Relay has no route for this token right now. Try USDC or another network.";
  return m.replace(/^.*?Error: /, "").slice(0, 220);
}
