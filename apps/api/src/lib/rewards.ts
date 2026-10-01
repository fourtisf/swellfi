import { z } from "zod";

/** Reward tiers. Economics are ALFA's call: override with REWARD_TIERS_JSON. */
export const tierSchema = z
  .array(
    z.object({
      name: z.string().min(1),
      /** 30d volume (USD) needed to reach the tier */
      minVolume: z.number().min(0),
      /** % of fees rebated */
      rebatePct: z.number().min(0).max(100),
      /** % of referred users' fees shared */
      referralPct: z.number().min(0).max(100),
    }),
  )
  .min(1);

export type Tier = z.infer<typeof tierSchema>[number];

// Prototype TIERS — placeholders until the economics are confirmed.
export const DEFAULT_TIERS: Tier[] = [
  { name: "Current", minVolume: 0, rebatePct: 10, referralPct: 10 },
  { name: "Swell", minVolume: 1e5, rebatePct: 25, referralPct: 15 },
  { name: "Breaker", minVolume: 1e6, rebatePct: 50, referralPct: 20 },
  { name: "Tsunami", minVolume: 1e7, rebatePct: 100, referralPct: 25 },
];

export function loadTiers(json?: string): Tier[] {
  if (!json) return DEFAULT_TIERS;
  return tierSchema.parse(JSON.parse(json)).sort((a, b) => a.minVolume - b.minVolume);
}

export function tierIndexFor(tiers: Tier[], volume30d: number) {
  let idx = 0;
  tiers.forEach((t, i) => {
    if (volume30d >= t.minVolume) idx = i;
  });
  return idx;
}
