import { TradeView } from "@/components/trade/trade-view";

export const metadata = { title: "Trade" };

export default function TradePage() {
  return <TradeView coin="BTC" />;
}
