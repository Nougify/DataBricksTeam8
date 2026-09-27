"use client";

// Preview dimming (spec §7.5, DESIGN §8.2 "Preview"): while a proposal is previewed, everything outside the
// preview set drops to ~20% opacity. Layers multiply their opacities by `dimFactor(...)`.
import { useSyncExternalStore } from "react";
import { useSim } from "@/lib/live/store";

/** Opacity multiplier for overlays outside the preview set. */
export const DIM_FACTOR = 0.2;

/** True while a trip is being previewed (`previewTripId` is set). */
export function useDimmed(): boolean {
  return useSim((s) => s.previewTripId !== null);
}

/** The hub of the previewed trip (its halo stays at full strength), or null outside preview. */
export function usePreviewHubId(): string | null {
  return useSim((s) => {
    const trip = s.previewTripId ? s.trips[s.previewTripId] : undefined;
    return trip ? (s.events[trip.dispatch_event_id]?.hub_id ?? null) : null;
  });
}

/** 1 normally; DIM_FACTOR while dimmed, unless this item is part of the preview set. */
export const dimFactor = (dimmed: boolean, inPreviewSet = false) => (dimmed && !inPreviewSet ? DIM_FACTOR : 1);

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** False while the tab is hidden, so ambient motion (the halo ripple) and rAF loops can pause. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}
