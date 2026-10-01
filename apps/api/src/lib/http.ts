import type { FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { ZodError, type ZodTypeAny, type z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const unauthorized = () => new HttpError(401, "UNAUTHORIZED", "Sign in first");
export const forbidden = (code = "FORBIDDEN", msg?: string) => new HttpError(403, code, msg);
export const notFound = (what = "Not found") => new HttpError(404, "NOT_FOUND", what);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export function errorHandler(err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: "VALIDATION", message: "Invalid input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: err.code, message: err.message });
  }
  if (err.statusCode && err.statusCode < 500) {
    // Fastify's own errors (rate limit, bad JSON, payload too large).
    return reply.status(err.statusCode).send({ error: err.code ?? "BAD_REQUEST", message: err.message });
  }
  req.log.error({ err }, "unhandled error");
  return reply.status(500).send({ error: "INTERNAL", message: "Something went wrong" });
}

/** Read-through JSON cache in Redis. Falls back to the loader if Redis is down. */
export async function cached<T>(redis: Redis, key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return load();
  }
  const value = await load();
  redis.set(key, JSON.stringify(value), "EX", ttlSec).catch(() => {});
  return value;
}
