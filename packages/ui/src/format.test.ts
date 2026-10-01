import { describe, expect, it } from "vitest";
import { ago, fDur, fPct, fPx, fUsd, fundingCountdown, pxInput, sgn, shortAddr } from "./format";
import { gradFor } from "./tokens";

describe("format", () => {
  it("formats prices by magnitude like the prototype", () => {
    expect(fPx(96420.46)).toBe("96,420.5");
    expect(fPx(212.4)).toBe("212.40");
    expect(fPx(2.41)).toBe("2.410");
    expect(fPx(0.271)).toBe("0.27100");
    expect(fPx(0.0061)).toBe("0.0061000");
    expect(fPx(null)).toBe("—");
    expect(pxInput(96420.46)).toBe("96420.5");
  });

  it("formats USD with suffixes", () => {
    expect(fUsd(3.2e9)).toBe("$3.20B");
    expect(fUsd(412800, 0)).toBe("$412.8K");
    expect(fUsd(18.62e6, 0)).toBe("$18.62M");
    expect(fUsd(950)).toBe("$950.00");
    expect(fUsd(-1234.5)).toBe("-$1,234.50");
  });

  it("formats percents, signs, durations, times", () => {
    expect(fPct(1.234)).toBe("+1.23%");
    expect(fPct(-0.5, 1)).toBe("-0.5%");
    expect(fPct(0)).toBe("0.00%");
    expect(sgn(0)).toBe("up");
    expect(sgn(-1)).toBe("dn");
    expect(fDur(5 * 6e4)).toBe("5m");
    expect(fDur(125 * 6e4)).toBe("2h 5m");
    expect(fDur(26 * 36e5)).toBe("1d 2h");
    expect(ago(1000, 31_000)).toBe("30s ago");
    expect(ago(0, 7200_000)).toBe("2h ago");
    expect(fundingCountdown(36e5 - 61_000)).toBe("01:01");
    expect(shortAddr("0x1234567890abcdef1234")).toBe("0x1234…1234");
  });

  it("picks a stable gradient per seed", () => {
    expect(gradFor("deepwaterdesk")).toEqual(gradFor("deepwaterdesk"));
  });
});
