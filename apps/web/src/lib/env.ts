import { resolveHlConfig, tenthsBpsToRate } from "@swellfi/hl";

// NEXT_PUBLIC_* values must be referenced literally so Next inlines them at build time.
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME || "Swellfi";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

export const HL = resolveHlConfig({
  network: process.env.NEXT_PUBLIC_HL_NETWORK,
  dataNetwork: process.env.NEXT_PUBLIC_HL_DATA_NETWORK,
  hip3Dexes: process.env.NEXT_PUBLIC_HL_HIP3_DEXES,
  infoUrl: process.env.NEXT_PUBLIC_HL_INFO_URL,
  wsUrl: process.env.NEXT_PUBLIC_HL_WS_URL,
  builderAddress: process.env.NEXT_PUBLIC_BUILDER_ADDRESS,
  builderFeeTenthsBps: process.env.NEXT_PUBLIC_BUILDER_FEE_TENTHS_BPS,
});

export const BUILDER_RATE = tenthsBpsToRate(HL.builder.feeTenthsBps);
