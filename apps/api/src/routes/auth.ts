import type { FastifyInstance } from "fastify";
import { getAddress, verifyMessage } from "viem";
import { z } from "zod";
import type { AppContext } from "../app";
import { badRequest } from "../lib/http";
import { addressSchema } from "../lib/validate";
import { newNonce, signInMessage, signSession } from "../lib/wallet-auth";

const NONCE_TTL_SEC = 300;

/** Wallet sign-in: POST /auth/nonce → sign the message → POST /auth/wallet → session token. */
export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { redis, env } = ctx;
  const url = new URL(env.APP_URL);

  app.post("/auth/nonce", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { address } = z.object({ address: addressSchema }).parse(req.body);
    const checksum = getAddress(address);
    const nonce = newNonce();
    const message = signInMessage({
      domain: url.host,
      uri: url.origin,
      address: checksum,
      nonce,
      brand: env.NEXT_PUBLIC_BRAND_NAME,
      issuedAt: new Date().toISOString(),
    });
    // One key per request, so asking for a new message (anyone can, for any address) never
    // invalidates a message the wallet owner is signing.
    const a = address.toLowerCase();
    await redis.multi().set(`tl:siwe:${a}:${nonce}`, message, "EX", NONCE_TTL_SEC).set(`tl:siwe:${a}:last`, nonce, "EX", NONCE_TTL_SEC).exec();
    return { message };
  });

  app.post("/auth/wallet", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = z
      .object({ address: addressSchema, signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(1000), message: z.string().max(2000).optional() })
      .parse(req.body);
    const a = body.address.toLowerCase();
    const expired = () => badRequest("NONCE_EXPIRED", "Sign-in request expired. Try again.");
    // The signed message names its nonce; older clients don't send it back, so fall back to the latest.
    const nonce = body.message ? /^Nonce: ([0-9a-f]{24})$/m.exec(body.message)?.[1] : await redis.get(`tl:siwe:${a}:last`);
    if (!nonce) throw expired();
    const key = `tl:siwe:${a}:${nonce}`;
    const message = await redis.get(key);
    if (!message || (body.message != null && body.message !== message)) throw expired();
    const ok = await verifyMessage({ address: getAddress(body.address), message, signature: body.signature as `0x${string}` }).catch(() => false);
    // A wrong signature doesn't burn the nonce (or anyone could cancel a sign-in in progress).
    if (!ok) throw badRequest("BAD_SIGNATURE", "Signature doesn't match this wallet");
    // Single use: only the request that deletes the key gets a session.
    if ((await redis.del(key)) !== 1) throw expired();
    return signSession(env.SESSION_SECRET, body.address);
  });
}
