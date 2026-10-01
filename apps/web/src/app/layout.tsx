import "@tideline/ui/styles.css";
import "@tideline/ui/premium.css";
import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import type { ReactNode } from "react";
import { Overlays } from "@/components/overlays";
import { Footer, Header, MobileNav } from "@/components/shell";
import { BRAND } from "@/lib/env";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${BRAND} — Trade perps. Get followed.`, template: `%s · ${BRAND}` },
  description: "Trade crypto, stocks and commodities with leverage on Hyperliquid. Follow the traders worth following and build a track record of your own.",
  applicationName: BRAND,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1012",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body>
        <Providers>
          <Header />
          <main>{children}</main>
          <Footer />
          <MobileNav />
          <Overlays />
        </Providers>
      </body>
    </html>
  );
}
