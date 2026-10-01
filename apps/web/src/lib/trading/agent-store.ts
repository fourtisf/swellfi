"use client";

import type { PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Browser-only vault for the trading agent key.
 *
 * The agent private key is generated here and never leaves the browser. At rest it is
 * encrypted with AES-GCM under a non-extractable WebCrypto key that also lives in
 * IndexedDB, so the raw key bytes are never written to storage. The agent can place and
 * cancel orders; it cannot withdraw (withdrawals are signed by the master wallet).
 */

const DB = "tideline-vault";
const STORE = "kv";
const VAULT_KEY = "vault-key";

interface StoredAgent {
  address: `0x${string}`;
  iv: Uint8Array;
  ct: ArrayBuffer;
  createdAt: number;
  validUntil: number;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function vaultKey(): Promise<CryptoKey> {
  const existing = await tx<CryptoKey | undefined>("readonly", (s) => s.get(VAULT_KEY));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await tx("readwrite", (s) => s.put(key, VAULT_KEY));
  return key;
}

const slot = (network: string, master: string) => `agent:${network}:${master.toLowerCase()}`;

export async function loadAgent(network: string, master: string): Promise<{ account: PrivateKeyAccount; validUntil: number } | null> {
  const rec = await tx<StoredAgent | undefined>("readonly", (s) => s.get(slot(network, master)));
  if (!rec) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv as BufferSource }, await vaultKey(), rec.ct);
    const account = privateKeyToAccount(new TextDecoder().decode(pt) as `0x${string}`);
    if (account.address.toLowerCase() !== rec.address.toLowerCase()) return null;
    return { account, validUntil: rec.validUntil };
  } catch {
    return null;
  }
}

/** Generates a fresh agent key (never reuse agent addresses) and stores it encrypted. */
export async function createAgent(network: string, master: string, validUntil: number): Promise<PrivateKeyAccount> {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await vaultKey(), new TextEncoder().encode(pk));
  const rec: StoredAgent = { address: account.address, iv, ct, createdAt: Date.now(), validUntil };
  await tx("readwrite", (s) => s.put(rec, slot(network, master)));
  return account;
}

export async function forgetAgent(network: string, master: string) {
  await tx("readwrite", (s) => s.delete(slot(network, master)));
}
