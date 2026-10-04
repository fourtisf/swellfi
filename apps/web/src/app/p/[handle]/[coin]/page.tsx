import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharePage } from "@/components/share-page";
import { BRAND } from "@/lib/env";
import { sharePositionHref } from "@/lib/routes";
import { CARD, livePosition, type CardData } from "@/lib/share-card";

type Props = { params: { handle: string; coin: string }; searchParams: { amt?: string } };

// Always live: the position can change between two visits.
export const dynamic = "force-dynamic";

const titleOf = (c: CardData) => {
  const coin = c.coin.includes(":") ? c.coin.split(":")[1] : c.coin;
  const r = c.roe != null ? ` ${c.roe >= 0 ? "+" : "−"}${Math.abs(c.roe).toFixed(1)}%` : "";
  return `${c.handle} is ${c.side} ${coin}${c.lev ? ` ${c.lev}x` : ""}${r}`;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const handle = decodeURIComponent(params.handle), coin = decodeURIComponent(params.coin);
  const card = await livePosition(handle, coin);
  if (!card) return { title: "No open position" };
  const title = `${titleOf(card)} on ${BRAND}`;
  const image = { url: `${sharePositionHref(handle, coin)}/image?t=${Math.floor(Date.now() / 60_000)}${searchParams.amt === "0" ? "&amt=0" : ""}`, ...CARD, alt: title };
  return { title, openGraph: { title, images: [image] }, twitter: { card: "summary_large_image", title, images: [image] } };
}

export default async function SharedPosition({ params, searchParams }: Props) {
  const handle = decodeURIComponent(params.handle), coin = decodeURIComponent(params.coin);
  const card = await livePosition(handle, coin);
  if (!card) notFound();
  return (
    <SharePage
      image={`${sharePositionHref(handle, coin)}/image?t=${Math.floor(Date.now() / 60_000)}${searchParams.amt === "0" ? "&amt=0" : ""}`}
      title={titleOf(card)}
      handle={handle}
      coin={coin}
    />
  );
}
