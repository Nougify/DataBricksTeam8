"use client";

import { APP } from "@/config/app";
import { cn } from "@/lib/utils";
import { OverflowMenu, PhoneMenu } from "./Menus";
import { AutoPauseSwitch, DatePicker, PresetsMenu, ResetDemoButton } from "./ScenarioControls";
import { SimClock } from "./SimClock";
import { AboutButton, ConnectionStatus, MockBadge, ThemeToggle } from "./StatusControls";
import { PlayPauseButton, SpeedControl } from "./Transport";

/**
 * The top bar (spec §6, DESIGN.md §6). Layout is CSS only:
 * - phone (< 768): name with a status line under it, clock, Play/Pause, menu. 48 px.
 * - tablet (768–1279): name + status line, clock, Play/Pause, speed, overflow menu. 56 px.
 * - desktop (1280–1759): two rows (48 + 40). Row 1: identity, clock, transport, then status, theme and About
 *   on the right. Row 2: the scenario controls, left-aligned under the clock.
 * - wide (≥ 1760): everything on one 56 px row. DESIGN.md puts this at 1600 px; the placeholder name is long
 *   enough that one row only fits from about 1760 px, so the switch waits until then.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background">
      <div
        className={cn(
          "flex h-12 items-center gap-2 px-3 md:h-14 md:gap-4 md:px-4",
          "xl:grid xl:h-auto xl:grid-cols-[auto_auto_minmax(0,1fr)] xl:gap-x-6 xl:gap-y-0",
          "min-[1760px]:flex min-[1760px]:h-14 min-[1760px]:gap-6",
        )}
      >
        {/* Identity. Below 1280 px the connection status and "Mock data" sit on a line under the name. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 xl:h-12 xl:flex-none">
          <h1 className="truncate font-heading text-base leading-tight font-semibold md:text-lg" title={APP.name}>
            {APP.name}
          </h1>
          {APP.tagline && <p className="hidden truncate text-xs text-muted-foreground xl:block">{APP.tagline}</p>}
          <div className="flex min-w-0 items-center gap-3 overflow-hidden xl:hidden">
            <ConnectionStatus size="xs" />
            <MockBadge size="xs" />
          </div>
        </div>

        {/* Clock and transport. */}
        <div className="flex shrink-0 items-center gap-2 md:gap-3 xl:h-12">
          <SimClock />
          <PlayPauseButton />
          <SpeedControl className="hidden md:flex" />
        </div>

        {/* Scenario controls: row 2 on desktop, inline when wide, in the overflow menu below 1280 px. */}
        <div className="hidden items-center gap-3 xl:col-span-2 xl:col-start-2 xl:row-start-2 xl:flex xl:h-10 xl:pb-1 min-[1760px]:h-auto min-[1760px]:pb-0">
          <PresetsMenu />
          <DatePicker />
          <AutoPauseSwitch className="ml-1" />
          <ResetDemoButton />
        </div>

        {/* Status and app controls (desktop). */}
        <div className="hidden items-center gap-3 xl:col-start-3 xl:row-start-1 xl:flex xl:h-12 xl:justify-self-end min-[1760px]:ml-auto min-[1760px]:h-auto">
          <ConnectionStatus />
          <MockBadge />
          <ThemeToggle />
          <AboutButton />
        </div>

        <OverflowMenu className="hidden md:inline-flex xl:hidden" />
        <PhoneMenu className="md:hidden" />
      </div>
    </header>
  );
}
