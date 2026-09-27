"use client";

import { Timeline } from "@/features/timeline/Timeline";
import { useBreakpoint } from "@/lib/useBreakpoint";

/**
 * The timeline scrubber (spec §17.1): 88 px with three lanes on desktop, a compact 56 px markers-only strip on
 * tablet. On phone the Console shows the full version inside the "Timeline" bottom sheet.
 */
export function TimelineSlot({ className }: { className?: string }) {
  const bp = useBreakpoint();
  return <Timeline compact={bp === "tablet"} className={className} />;
}
