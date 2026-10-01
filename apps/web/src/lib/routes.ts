import type { IconName } from "@tideline/ui";

/** URL for a market. HIP-3 names keep their dex prefix: /trade/xyz:NVDA */
export const tradeHref = (coin: string) => `/trade/${encodeURIComponent(coin).replace(/%3A/gi, ":")}`;
export const traderHref = (handle: string) => `/u/${encodeURIComponent(handle)}`;
export const fundHref = (id: string) => `/funds/${encodeURIComponent(id)}`;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Portfolio", icon: "home" },
  { href: "/trade", label: "Trade", icon: "trade" },
  { href: "/markets", label: "Markets", icon: "chart" },
  { href: "/feed", label: "Feed", icon: "feed" },
  { href: "/rankings", label: "Rankings", icon: "rank" },
  { href: "/funds", label: "Funds", icon: "fund" },
  { href: "/rewards", label: "Rewards", icon: "gift" },
];

export const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
