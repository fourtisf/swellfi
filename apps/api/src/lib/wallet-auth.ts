import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthIdentity, AuthVerifier } from "./auth";

/**
 * Sign-in with an Ethereum wallet (MetaMask, Rabby, any injected EIP-1193 wallet) without a
 * third-party auth provider: the API issues a one-time message, the wallet signs it, and we
 * return a short-lived HMAC-signed session token. Subjects look like `wallet:0xabc…`.
 */

export const SESSION_TTL_SEC = 7 * 24 * 3600;
const PREFIX = "tlw1"; // token format marker, never a valid Privy JWT

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(secret: string, address: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const payload = b64(JSON.stringify({ sub: `wallet:${address.toLowerCase()}`, exp }));
  const sig = b64(createHmac("sha256", secret).update(`${PREFIX}.${payload}`).digest());
  return { token: `${PREFIX}.${payload}.${sig}`, expiresAt: exp * 1000 };
}

export function verifySession(secret: string, token: string, now = Date.now()): AuthIdentity | null {
  const [prefix, payload, sig] = token.split(".");
  if (prefix !== PREFIX || !payload || !sig) return null;
  const want = createHmac("sha256", secret).update(`${PREFIX}.${payload}`).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; exp: number };
    if (typeof sub !== "string" || !sub.startsWith("wallet:") || exp * 1000 < now) return null;
    return { privyId: sub };
  } catch {
    return null;
  }
}

export const walletOf = (subject: string) => (subject.startsWith("wallet:") ? subject.slice(7) : null);

/** Wallet sessions first (cheap, local), then the provider verifier (Privy) if configured. */
export function withWalletSessions(inner: AuthVerifier, secret: string): AuthVerifier {
  return {
    async verify(token) {
      if (token.startsWith(`${PREFIX}.`)) {
        const id = verifySession(secret, token);
        if (!id) throw new Error("invalid session");
        return id;
      }
      return inner.verify(token);
    },
    async linkedWallets(subject) {
      const w = walletOf(subject);
      return w ? [w] : inner.linkedWallets(subject);
    },
  };
}

/** EIP-4361 (SIWE) style message. */
export function signInMessage(p: { domain: string; uri: string; address: string; nonce: string; brand: string; issuedAt: string }) {
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    "",
    `Sign in to ${p.brand}. This request does not cost gas and cannot move your funds.`,
    "",
    `URI: ${p.uri}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
  ].join("\n");
}

export const newNonce = () => randomBytes(12).toString("hex");
