// Design tokens from the prototype's final CSS layer. styles.css is the source of
// truth for the DOM; these are for canvas drawing (charts) and inline SVG.

export const tokens = {
  bg: "#0E1315",
  panel: "#13191B",
  panel2: "#1A2124",
  chartBg: "#0B1012",
  input: "#12181A",
  stroke: "rgba(255,255,255,.075)",
  stroke2: "rgba(255,255,255,.12)",
  text: "#E9EDEE",
  muted: "#8C9598",
  dim: "#5F686B",
  brand: "#16C784",
  brand2: "#0FA968",
  long: "#16C784",
  short: "#EA3943",
  warn: "#F5B53D",
  radius: { sm: 8, md: 12, lg: 18, xl: 24 },
} as const;

/** Avatar / coin-fallback gradients (prototype GRAD). */
export const GRAD: ReadonlyArray<readonly [string, string]> = [
  ["#16C784", "#5B45E0"],
  ["#16C784", "#1C6FA8"],
  ["#16C784", "#0F8A63"],
  ["#FFB27A", "#C4562B"],
  ["#FF8FB1", "#B8326A"],
  ["#9BE7E1", "#2B8A8F"],
  ["#D5C2FF", "#7A4FD0"],
  ["#C4E77A", "#5E8E1E"],
];

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const gradFor = (s: string) => GRAD[hash(s) % GRAD.length]!;
