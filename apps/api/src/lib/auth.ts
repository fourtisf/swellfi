import { PrivyClient } from "@privy-io/node";

/** Identity of the caller, as proven by a Privy access token. */
export interface AuthIdentity {
  privyId: string;
}

export interface AuthVerifier {
  /** Verifies a Privy access token (ES256 JWT). Throws if invalid or expired. */
  verify(token: string): Promise<AuthIdentity>;
  /** Lowercased Ethereum addresses linked to this Privy user (embedded + external). */
  linkedWallets(privyId: string): Promise<string[]>;
}

/**
 * Privy verifier. With PRIVY_VERIFICATION_KEY set, tokens are verified locally; otherwise
 * the SDK fetches (and caches) the app's JWKS from Privy.
 */
export function createPrivyVerifier(appId: string, appSecret: string, verificationKey?: string): AuthVerifier {
  if (!appId || !appSecret) {
    return {
      verify: async () => {
        throw new Error("Privy is not configured (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET)");
      },
      linkedWallets: async () => [],
    };
  }
  const privy = new PrivyClient({ appId, appSecret, ...(verificationKey ? { jwtVerificationKey: verificationKey } : {}) });
  return {
    async verify(token) {
      const claims = await privy.utils().auth().verifyAccessToken(token);
      return { privyId: claims.user_id };
    },
    async linkedWallets(privyId) {
      const user = await privy.users()._get(privyId);
      return user.linked_accounts
        .filter((a) => a.type === "wallet" && "chain_type" in a && a.chain_type === "ethereum" && "address" in a)
        .map((a) => (a as { address: string }).address.toLowerCase());
    },
  };
}
