import type { Page } from "@playwright/test";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * A fake browser wallet for tests: announced as MetaMask via EIP-6963 inside the page, while
 * keys and signing live in the test process (viem local account). Sends go to the mock
 * Arbitrum RPC.
 */
export async function installTestWallet(page: Page, rpcUrl: string, privateKey: `0x${string}` = generatePrivateKey()) {
  const account = privateKeyToAccount(privateKey);
  let chainId = 1;

  const rpc = async (method: string, params: unknown[]) => {
    const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const j = (await r.json()) as { result?: unknown; error?: { message: string } };
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };

  await page.exposeFunction("__testWallet", async (method: string, params: unknown[] = []) => {
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return toHex(chainId);
      case "wallet_switchEthereumChain":
        chainId = Number((params[0] as { chainId: string }).chainId);
        return null;
      case "wallet_addEthereumChain":
        return null;
      case "personal_sign":
        return account.signMessage({ message: { raw: params[0] as `0x${string}` } });
      case "eth_signTypedData_v4": {
        const td = JSON.parse(params[1] as string);
        delete td.types.EIP712Domain;
        // JSON-RPC typed data carries uints as strings/numbers; viem wants bigints.
        for (const f of td.types[td.primaryType]) if (/^u?int/.test(f.type)) td.message[f.name] = BigInt(td.message[f.name]);
        if (td.domain.chainId != null) td.domain.chainId = Number(td.domain.chainId);
        return account.signTypedData(td);
      }
      case "eth_sendTransaction":
        return rpc("eth_sendTransaction", [{ ...(params[0] as object), from: account.address }]);
      default:
        return rpc(method, params);
    }
  });

  await page.addInitScript(() => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await (window as any).__testWallet(method, params ?? []);
        } catch (e) {
          throw Object.assign(new Error(String((e as Error).message ?? e)), { code: -32603 });
        }
      },
      on: (ev: string, fn: (...a: unknown[]) => void) => (listeners[ev] ??= []).push(fn),
      removeListener: (ev: string, fn: (...a: unknown[]) => void) => {
        listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
      },
    };
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "test", name: "MetaMask", icon: "", rdns: "io.metamask" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });

  return account;
}
