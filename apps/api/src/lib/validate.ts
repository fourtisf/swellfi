import { z } from "zod";

/** Hyperliquid coin names: "BTC", "kPEPE", "xyz:NVDA". */
export const coinSchema = z.string().regex(/^[A-Za-z0-9]{1,16}(:[A-Za-z0-9._-]{1,24})?$/, "invalid coin");

export const handleSchema = z
  .string()
  .min(3)
  .max(24)
  .regex(/^[a-z0-9_.]+$/, "lowercase letters, digits, _ and . only");

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");

export const inviteCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/)
  .transform((s) => s.toUpperCase());

export const cursorSchema = z.string().max(64).optional();

export const limitSchema = (max: number, dflt: number) => z.coerce.number().int().min(1).max(max).default(dflt);
