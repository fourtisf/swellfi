"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { configureCoinLogos } from "@swellfi/ui";
import { BUNDLED_LOGOS } from "@/generated/logos";
import { bootMarkets } from "@/lib/market";
import { SessionProvider } from "@/lib/session";

configureCoinLogos({ bundled: BUNDLED_LOGOS });

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  useEffect(() => bootMarkets(), []);
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
