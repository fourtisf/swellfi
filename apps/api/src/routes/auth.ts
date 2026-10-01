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
    const message = signInMessage({
      domain: url.host,
      uri: url.origin,
      address: checksum,
      nonce: newNonce(),
      brand: env.NEXT_PUBLIC_BRAND_NAME,
      issuedAt: new Date().toISOString(),
    });
    await redis.set(`tl:siwe:${address.toLowerCase()}`, message, "EX", NONCE_TTL_SEC);
    return { message };
  });

  app.post("/auth/wallet", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({ address: addressSchema, signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(1000) }).parse(req.body);
    const key = `tl:siwe:${body.address.toLowerCase()}`;
    const [[, message]] = (await redis.multi().get(key).del(key).exec()) as [[unknown, string | null], unknown];
    if (!message) throw badRequest("NONCE_EXPIRED", "Sign-in request expired. Try again.");
    const ok = await verifyMessage({ address: getAddress(body.address), message, signature: body.signature as `0x${string}` }).catch(() => false);
    if (!ok) throw badRequest("BAD_SIGNATURE", "Signature doesn't match this wallet");
    return signSession(env.SESSION_SECRET, body.address);
  });
}
