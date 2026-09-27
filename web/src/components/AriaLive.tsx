"use client";

import { useSim } from "@/lib/live/store";

/** Visually hidden polite live region; announces new proposals and other live changes. */
export function AriaLive() {
  const announcement = useSim((s) => s.announcement);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
