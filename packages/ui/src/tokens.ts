// Design tokens from the prototype's final CSS layer. styles.css is the source of
// truth for the DOM; these are for canvas drawing (charts) and inline SVG.

export const tokens = {
  bg: "#080D17",
  panel: "#0D1320",
  panel2: "#121A2A",
  chartBg: "#070B14",
  input: "#0C1222",
  stroke: "rgba(255,255,255,.075)",
  stroke2: "rgba(255,255,255,.12)",
  text: "#EAF1FA",
  muted: "#8B97AD",
  dim: "#5A6680",
  brand: "#4DB5FF",
  brand2: "#2F86F0",
  long: "#16C784",
  short: "#EA3943",
  warn: "#F5B53D",
  radius: { sm: 8, md: 12, lg: 18, xl: 24 },
} as const;

/** Avatar / coin-fallback gradients (prototype GRAD). */
export const GRAD: ReadonlyArray<readonly [string, string]> = [
  ["#9AF1FF", "#3F5BE0"],
  ["#4DB5FF", "#1D5FD1"],
  ["#7FD8FF", "#1C6FA8"],
  ["#FFB27A", "#C4562B"],
  ["#FF8FB1", "#B8326A"],
  ["#9BE7E1", "#2B8A8F"],
  ["#D5C2FF", "#7A4FD0"],
  ["#C4E77A", "#5E8E1E"],
];

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const gradFor = (s: string) => GRAD[hash(s) % GRAD.length]!;
