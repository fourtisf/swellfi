import { activityById, cardFromActivity, renderCard } from "@/lib/share-card";

// PNG card for one indexed trade (open or close). ?amt=0 hides dollar amounts.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const a = await activityById(decodeURIComponent(params.id));
  const card = a && cardFromActivity(a);
  if (!card) return new Response("Not found", { status: 404 });
  return renderCard(card, { amounts: new URL(req.url).searchParams.get("amt") !== "0" });
}
