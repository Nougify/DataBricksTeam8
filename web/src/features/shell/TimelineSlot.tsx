import { cn } from "@/lib/utils";

/**
 * Placeholder for the timeline scrubber (spec §17.1), replaced in milestone 2. It holds the strip's final
 * height so the layout around it is already right: 88 px on desktop, a compact 56 px on tablet. On phone the
 * Console shows it inside the "Timeline" bottom sheet instead.
 */
export function TimelineSlot({ className }: { className?: string }) {
  return (
    <section
      aria-label="Timeline"
      className={cn("flex h-14 shrink-0 items-center gap-3 border-t bg-background px-4 xl:h-[88px]", className)}
    >
      <p className="text-sm font-semibold">Timeline</p>
      <p className="text-xs text-muted-foreground">
        Daily pings per hub, Nov 2025 to Aug 2026, arrive in the next build step.
      </p>
    </section>
  );
}
