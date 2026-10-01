import { TradeView } from "@/components/trade/trade-view";

export default function TradeCoinPage({ params }: { params: { coin: string } }) {
  return <TradeView coin={decodeURIComponent(params.coin)} />;
}
