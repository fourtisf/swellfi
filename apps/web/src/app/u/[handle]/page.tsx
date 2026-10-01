import type { Metadata } from "next";
import { ProfileView } from "@/components/profile";

export function generateMetadata({ params }: { params: { handle: string } }): Metadata {
  return { title: decodeURIComponent(params.handle) };
}

export default function TraderPage({ params }: { params: { handle: string } }) {
  return (
    <section className="view on">
      <ProfileView handle={decodeURIComponent(params.handle)} />
    </section>
  );
}
