// @ts-nocheck

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { trackPageview } from "@/features/canvas/lib/analytics";

// Observe SPA route changes and report page views; trackPageview is a no-op when analytics is not configured.
export function AnalyticsTracker() {
  const pathname = usePathname();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const query = searchParams?.toString();
    trackPageview(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  return null;
}
