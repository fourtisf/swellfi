import { livePosition, renderCard } from "@/lib/share-card";

// PNG card for a member's open position, read live from Hyperliquid. ?amt=0 hides dollar amounts.
export async function GET(req: Request, { params }: { params: { handle: string; coin: string } }) {
  const card = await livePosition(decodeURIComponent(params.handle), decodeURIComponent(params.coin));
  if (!card) return new Response("No open position", { status: 404 });
  return renderCard(card, { amounts: new URL(req.url).searchParams.get("amt") !== "0" });
}
