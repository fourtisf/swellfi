import { MarketHighlights, MarketsTable } from "@/components/markets";

export const metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <section className="view on">
      <div className="wrap-1040 wide">
        <div className="page-head">
          <div>
            <h2>Markets</h2>
            <p>Every perpetual on Hyperliquid: crypto, stocks, commodities and indices. Live prices, volume, open interest and funding.</p>
          </div>
        </div>
        <MarketHighlights />
        <MarketsTable limit={50} />
      </div>
    </section>
  );
}
