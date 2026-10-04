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

// The project token's contract address (CA), shown on the home page and in the footer.
// NEXT_PUBLIC_TOKEN_CA overrides it; set it empty to hide it. NEXT_PUBLIC_TOKEN_URL is an
// optional chart or explorer link for it.
const ca = (process.env.NEXT_PUBLIC_TOKEN_CA ?? "0x14041e3f5ad1bda8c6d88e5836ac8004391c914f").trim();
export const TOKEN_CA = /^0x[0-9a-fA-F]{40}$/.test(ca) ? ca : "";
export const TOKEN_URL = /^https:\/\//.test(process.env.NEXT_PUBLIC_TOKEN_URL ?? "") ? process.env.NEXT_PUBLIC_TOKEN_URL! : "";

/** The official X account. */
export const X_URL = process.env.NEXT_PUBLIC_X_URL || "https://x.com/swellfixyz";
