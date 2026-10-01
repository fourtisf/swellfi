"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Referral link: remember the code for sign-up, then land on the home page. */
export default function ReferralPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  useEffect(() => {
    const code = decodeURIComponent(params.code).slice(0, 32);
    try {
      if (/^[a-z0-9]+$/i.test(code)) localStorage.setItem("tl:ref", code);
    } catch {
      /* storage blocked */
    }
    router.replace("/");
  }, [params.code, router]);
  return <div className="empty">Taking you to the app…</div>;
}
