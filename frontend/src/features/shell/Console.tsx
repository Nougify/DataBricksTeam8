"use client";

// The one-screen console (spec §5, DESIGN.md §6). Layout is CSS; JS decides only what differs in behaviour:
// - desktop ≥ 1280: top bar, map filling the rest, and a 420 px side panel column;
// - tablet 768–1279: the panel is a 380 px drawer over the map. It opens when a hub gets selected, a button
//   re-opens it, and it is inert while closed;
// - phone < 768: the page scrolls. Map at 45vh, with the operational panel below at full width.
// The side panel is one element in every layout, so switching sizes never remounts it.
import { useEffect, useRef, useState } from "react";
import { PanelRightOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConsoleMap } from "@/features/map";
import { TopBar } from "@/features/topbar";
import { AboutDialog } from "@/features/about/AboutDialog";
import { useSim } from "@/lib/live/store";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";
import { GlobalBanners } from "./GlobalBanners";
import { SidePanel } from "./SidePanel";
import { useEscapeToClear } from "./useEscape";

export function Console() {
  const bp = useBreakpoint();
  const isTablet = bp === "tablet";
  const [drawerOpen, setDrawerOpen] = useState(() => useSim.getState().selectedHubId !== null);
  const panelRef = useRef<HTMLElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  // Tablet: selecting a hub (map, preset, toast, URL) opens the drawer.
  useEffect(
    () =>
      useSim.subscribe((s, prev) => {
        if (s.selectedHubId && s.selectedHubId !== prev.selectedHubId) setDrawerOpen(true);
      }),
    [],
  );

  const openDrawer = () => {
    setDrawerOpen(true);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    requestAnimationFrame(() => openButtonRef.current?.focus({ preventScroll: true }));
  };

  useEscapeToClear(isTablet && drawerOpen ? closeDrawer : undefined);

  return (
    <div className="flex min-h-dvh flex-1 flex-col overflow-x-clip md:h-dvh md:min-h-0 md:overflow-hidden">
      <TopBar />
      <GlobalBanners />

      <div className="relative flex flex-col md:min-h-0 md:flex-1 md:flex-row">
        <section aria-label="Map" className="relative h-[45svh] min-h-[200px] shrink-0 overflow-hidden md:h-auto md:min-w-0 md:flex-1">
          <ConsoleMap />
          {isTablet && !drawerOpen && (
            <Button
              ref={openButtonRef}
              variant="outline"
              className="absolute right-12 bottom-3 z-10 h-9 rounded-xl bg-card shadow-float"
              aria-controls="side-panel"
              aria-expanded={false}
              onClick={openDrawer}
            >
              <PanelRightOpen aria-hidden />
              Open panel
            </Button>
          )}
        </section>

        <aside
          id="side-panel"
          ref={panelRef}
          tabIndex={-1}
          aria-label="Side panel"
          inert={isTablet && !drawerOpen}
          data-drawer={drawerOpen ? "open" : "closed"}
          className={cn(
            "relative flex min-w-0 flex-col border-t bg-background outline-none md:border-t-0",
            // Tablet: a drawer over the map (card background, the one elevation), sliding in 200 ms.
            "md:max-xl:absolute md:max-xl:inset-y-0 md:max-xl:right-0 md:max-xl:z-20 md:max-xl:w-[380px]",
            "md:max-xl:border-l md:max-xl:bg-card md:max-xl:shadow-float",
            "md:max-xl:transition-[transform,visibility] md:max-xl:duration-200 md:max-xl:ease-out",
            "md:max-xl:data-[drawer=closed]:invisible md:max-xl:data-[drawer=closed]:translate-x-full",
            // Desktop: a fixed column.
            "xl:w-[420px] xl:shrink-0 xl:border-l",
          )}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-3 right-3 z-10 hidden md:max-xl:inline-flex"
            aria-label="Close panel"
            onClick={closeDrawer}
          >
            <X />
          </Button>
          <SidePanel />
        </aside>
      </div>

      <AboutDialog />
    </div>
  );
}
