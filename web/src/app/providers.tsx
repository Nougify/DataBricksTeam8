"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AriaLive } from "@/components/AriaLive";
import { isApiError } from "@/lib/api/client";
import { LiveBoot } from "@/lib/live/LiveBoot";
import { useUrlStateSync } from "@/lib/url/state";
import { useBreakpoint, useMediaQuery } from "@/lib/useBreakpoint";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Freshness follows the sim clock (query keys), not window focus.
        refetchOnWindowFocus: false,
        // A 4xx won't fix itself; network blips and 5xx get one more try.
        retry: (failureCount, error) =>
          !(isApiError(error) && error.status >= 400 && error.status < 500) && failureCount < 1,
      },
    },
  });
}

/**
 * Toasts stack top-right of the map area, clear of the side panel (DESIGN.md §7.2): right offset = panel
 * width + 16 px (420 desktop, the 380 px drawer on tablet), top offset = top-bar height + 16 px (the
 * desktop bar is two rows, 88 px, below 1760 px). Sonner applies mobileOffset below 600 px.
 */
function ConsoleToaster() {
  const bp = useBreakpoint();
  const oneRowBar = useMediaQuery("(min-width: 1760px)", true);
  const offset =
    bp === "desktop"
      ? { top: oneRowBar ? 72 : 104, right: 436 }
      : bp === "tablet"
        ? { top: 72, right: 396 }
        : { top: 56, right: 12 };
  return <Toaster position="top-right" offset={offset} mobileOffset={{ top: 56 }} visibleToasts={3} />;
}

function UrlStateSync(): null {
  useUrlStateSync();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <ConsoleToaster />
          <LiveBoot />
          <UrlStateSync />
          <AriaLive />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default Providers;
