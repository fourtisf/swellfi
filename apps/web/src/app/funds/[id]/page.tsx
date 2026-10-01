import { FundDetail } from "@/components/funds";

export const metadata = { title: "Fund" };

export default function FundPage({ params }: { params: { id: string } }) {
  return (
    <section className="view on">
      <FundDetail id={decodeURIComponent(params.id)} />
    </section>
  );
}
