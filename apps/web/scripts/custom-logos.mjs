// Hand-made logos for HIP-3 markets that no icon pack covers: commodities, indices, FX and a
// few companies missing from simple-icons. 32×32, circular, readable at 18px.

const circle = (fill, inner, stroke = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${fill.defs ?? ""}</defs><circle cx="16" cy="16" r="16" fill="${fill.paint ?? fill}"/>${stroke}${inner}</svg>`;

const grad = (id, a, b) => ({ defs: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`, paint: `url(#${id})` });

const bars = (c, shade) =>
  `<g fill="${c}"><path d="M8 21.5h7l1.2-4.5h-7z"/><path d="M16 21.5h7l1.2-4.5h-7z"/><path d="M12 16.2h7l1.2-4.5h-7z"/></g><g fill="${shade}" opacity=".35"><path d="M8 21.5h7l.4-1.5H8.4z"/><path d="M16 21.5h7l.4-1.5h-7z"/><path d="M12 16.2h7l.4-1.5h-7z"/></g>`;

const chart = (stroke) =>
  `<path d="M7 21l5-5.5 3.5 3L24.5 9.5" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 9.5h5v5" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;

const text = (t, color = "#fff", size = 13) =>
  `<text x="16" y="16" dy=".36em" text-anchor="middle" font-family="Inter,Arial,Helvetica,sans-serif" font-weight="800" font-size="${size}" fill="${color}">${t}</text>`;

const drop = `<path d="M16 6.5c3.4 4.6 6.3 8.2 6.3 11.6A6.3 6.3 0 0 1 9.7 18.1C9.7 14.7 12.6 11.1 16 6.5z" fill="#fff"/><path d="M13 18.6a3.2 3.2 0 0 0 3 3" stroke="#0E1416" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".45"/>`;
const flame = `<path d="M16.2 6c.6 3.2 4.8 5.4 4.8 10.2A5.1 5.1 0 0 1 16 21.6a5 5 0 0 1-5-5.1c0-2.4 1.3-3.6 2.4-5 .2 1.6.9 2.6 2 3.1-.6-2.9.2-6 .8-8.6z" fill="#fff"/>`;

const GOLD = circle(grad("g", "#F9D86B", "#B8860B"), bars("#7A5200", "#fff"));
const SILVER = circle(grad("s", "#F1F4F7", "#8E99A4"), bars("#4C5661", "#fff"));
const COPPER = circle(grad("c", "#F2A36B", "#A3501F"), bars("#5E2A0A", "#fff"));
const PLATINUM = circle(grad("p", "#E6E8F0", "#7E8597"), bars("#3D4252", "#fff"));
const OIL = circle(grad("o", "#3A3F44", "#121517"), drop);
const GAS = circle(grad("n", "#4FA3FF", "#1E5BD8"), flame);
const index = (a, b) => circle(grad(`i${a.slice(1)}`, a, b), chart("#fff"));

// Fallback for HYPE (Hyperliquid's CDN serves the official one first).
const HYPE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#072723"/><path d="M6.5 17.6c0-3.8 2.2-6.4 4.7-6.4 3.2 0 3.7 3.4 4.8 3.4s1.6-3.4 4.8-3.4c2.5 0 4.7 2.6 4.7 6.4 0 2.6-1.4 4-3.1 4-2.6 0-3.6-3-6.4-3s-3.8 3-6.4 3c-1.7 0-3.1-1.4-3.1-4z" fill="#97FCE4"/></svg>`;

export const CUSTOM_LOGOS = {
  HYPE,
  // commodities
  GOLD, XAU: GOLD, PAXG: undefined, SILVER, XAG: SILVER, COPPER, PLATINUM, PALLADIUM: PLATINUM,
  CL: OIL, OIL, WTI: OIL, BRENT: OIL, BRENTOIL: OIL, USOIL: OIL,
  NATGAS: GAS, NG: GAS,
  // indices
  SP500: index("#2C5BDA", "#163273"), US500: index("#2C5BDA", "#163273"), SPX500: index("#2C5BDA", "#163273"),
  XYZ100: index("#7B5BF2", "#3A2A9C"), NDX: index("#7B5BF2", "#3A2A9C"), NAS100: index("#7B5BF2", "#3A2A9C"), US100: index("#7B5BF2", "#3A2A9C"),
  DJI: index("#1D8C6E", "#0D4A3A"), US30: index("#1D8C6E", "#0D4A3A"), RUT: index("#C0563B", "#6B2A19"),
  JP225: index("#D23A3A", "#7A1717"), DE40: index("#E8B021", "#7A5A0A"), HK50: index("#D23A3A", "#7A1717"),
  // FX
  EUR: circle(grad("eu", "#2D5BE3", "#173A9A"), text("€", "#FFD84D", 17)),
  JPY: circle(grad("jp", "#F1F3F5", "#C9CED4"), `<circle cx="16" cy="16" r="6.2" fill="#D3263A"/>`),
  GBP: circle(grad("gb", "#24408E", "#14244F"), text("£", "#fff", 17)),
  CNH: circle(grad("cn", "#E0312B", "#9C1A16"), text("¥", "#FFDE00", 17)),
  DXY: circle(grad("dx", "#2E7D4F", "#14452A"), text("$", "#fff", 17)),
  // companies missing from simple-icons
  MSFT: circle("#1F2326", `<g transform="translate(9 9)"><rect width="6.6" height="6.6" fill="#F25022"/><rect x="7.4" width="6.6" height="6.6" fill="#7FBA00"/><rect y="7.4" width="6.6" height="6.6" fill="#00A4EF"/><rect x="7.4" y="7.4" width="6.6" height="6.6" fill="#FFB900"/></g>`),
  AMZN: circle("#131921", `${text("a", "#fff", 17)}<path d="M9.5 20.2c4 2.5 9.4 2.6 13 0" stroke="#FF9900" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20.6 19l2.3 1.1-.6 2.4" stroke="#FF9900" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  ORCL: circle("#C74634", `<rect x="7.5" y="11.5" width="17" height="9" rx="4.5" fill="none" stroke="#fff" stroke-width="2.6"/>`),
  IBM: circle("#0F62FE", text("IBM", "#fff", 9)),
  JPM: circle("#3B2A20", text("JPM", "#fff", 9)),
  WMT: circle("#0071DC", text("✱", "#FFC220", 18)),
  DIS: circle("#0E1E5B", text("D", "#fff", 17)),
  BRK: circle("#1C2A4A", text("BRK", "#fff", 8.5)),
  TSM: circle("#C8102E", text("TSM", "#fff", 8.5)),
  ASML: circle("#10069F", text("ASML", "#fff", 7.5)),
  SMCI: circle("#0A6B3B", text("SMCI", "#fff", 7.5)),
  RIVN: circle("#F2A900", text("R", "#13171A", 17)),
  GME: circle("#E31B23", text("GME", "#fff", 8.5)),
  CRWV: circle("#2B39E8", text("CW", "#fff", 11)),
  MU: circle("#0A3E7A", text("MU", "#fff", 11)),
  LLY: circle("#D52B1E", text("Lilly", "#fff", 7)),
  BA: circle("#1D4F91", text("BA", "#fff", 11)),
};

// Ticker → simple-icons slug, rendered as a white glyph on the brand colour.
export const STOCK_SLUGS = {
  NVDA: "nvidia", TSLA: "tesla", AAPL: "apple", GOOGL: "google", GOOG: "google", META: "meta", NFLX: "netflix", COIN: "coinbase",
  HOOD: "robinhood", PLTR: "palantir", AMD: "amd", INTC: "intel", MSTR: "microstrategy", BABA: "alibabadotcom", CRCL: "circle",
  AVGO: "broadcom", UBER: "uber", ABNB: "airbnb", SHOP: "shopify", PYPL: "paypal", V: "visa", MA: "mastercard", NKE: "nike",
  KO: "cocacola", MCD: "mcdonalds", SPOT: "spotify", SNAP: "snapchat", ARM: "arm", SBUX: "starbucks", ADBE: "adobe",
  CRM: "salesforce", QCOM: "qualcomm", SONY: "sony", BIDU: "baidu", RDDT: "reddit", PINS: "pinterest", DELL: "dell",
  HPQ: "hp", CSCO: "cisco", SQ: "square", XYZ: "square", NOW: "servicenow", SNOW: "snowflake", NET: "cloudflare", DDOG: "datadog",
};

// Hyperliquid ticker → icon-pack symbol.
export const ALIASES = { RENDER: "RNDR", POL: "MATIC", WBTC: "BTC", WETH: "ETH", USDE: "USDE", S: "SONIC" };
