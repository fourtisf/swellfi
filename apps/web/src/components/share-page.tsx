import Link from "next/link";
import { BRAND } from "@/lib/env";
import { traderHref, tradeHref } from "@/lib/routes";

/** Landing for a shared PnL card: the card itself and the way into the app. */
export function SharePage({ image, title, handle, coin, external }: { image: string; title: string; handle: string; coin: string; external?: boolean }) {
  const name = coin.includes(":") ? coin.split(":")[1] : coin;
  return (
    <section className="view on sharepage">
      <h2>{title}</h2>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={title} width={1200} height={630} />
      <div className="ctas">
        <Link className="btn btn-brand" href={tradeHref(coin)}>
          Trade {name} on {BRAND} →
        </Link>
        {!external && (
          <Link className="btn btn-ghost" href={traderHref(handle)}>
            See {handle}&apos;s profile
          </Link>
        )}
      </div>
      <p className="dim">Real trade data from Hyperliquid. Perpetual futures are leveraged and high risk.</p>
    </section>
  );
}
