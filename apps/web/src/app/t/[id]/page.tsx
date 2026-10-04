import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharePage } from "@/components/share-page";
import { BRAND } from "@/lib/env";
import { shareTradeHref } from "@/lib/routes";
import { activityById, CARD, cardFromActivity, type CardData } from "@/lib/share-card";

type Props = { params: { id: string }; searchParams: { amt?: string } };

const titleOf = (c: CardData) => {
  const coin = c.coin.includes(":") ? c.coin.split(":")[1] : c.coin;
  const side = c.side === "long" ? "Long" : "Short";
  if (c.kind === "open") return `${c.handle} opened ${coin} ${side}${c.lev ? ` ${c.lev}x` : ""}`;
  const r = c.roe != null ? `${c.roe >= 0 ? "+" : "−"}${Math.abs(c.roe).toFixed(1)}%` : "";
  return `${c.handle} closed ${coin} ${side}${r ? ` for ${r}` : ""}`;
};

async function load(id: string) {
  const a = await activityById(decodeURIComponent(id));
  const card = a && cardFromActivity(a);
  return a && card ? { a, card } : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const r = await load(params.id);
  if (!r) return { title: "Trade not found" };
  const title = `${titleOf(r.card)} on ${BRAND}`;
  const image = { url: `${shareTradeHref(r.a.id)}/image${searchParams.amt === "0" ? "?amt=0" : ""}`, ...CARD, alt: title };
  return { title, openGraph: { title, images: [image] }, twitter: { card: "summary_large_image", title, images: [image] } };
}

export default async function SharedTrade({ params, searchParams }: Props) {
  const r = await load(params.id);
  if (!r) notFound();
  return (
    <SharePage
      image={`${shareTradeHref(r.a.id)}/image${searchParams.amt === "0" ? "?amt=0" : ""}`}
      title={titleOf(r.card)}
      handle={r.a.user.handle}
      coin={r.card.coin}
      external={Boolean(r.a.user.kind && r.a.user.kind !== "member")}
    />
  );
}
