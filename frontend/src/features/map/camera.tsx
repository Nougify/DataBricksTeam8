"use client";

// Decides what the camera should show and hands it to useMapFit (spec §7.2):
//   network        → METRO_BOUNDS;
//   hub selected   → the hub plus its regional origins with a share of at least 2% → key `hub:<id>:origins` once the
//                    mix is ready (the key doesn't change with the hour or basis, so the view never jumps mid-play);
//   trip preview   → every leg of the previewed trip's movement plan (deadhead, service, return) →
//                    key `preview:<tripId>`. Leaving the preview drops back to the hub (or network) view.
import { useMemo } from "react";
import { useOriginMix } from "@/features/hub/origins/useOriginMix";
import type { AdditionalTrip } from "@/lib/api/schemas";
import { useSim } from "@/lib/live/store";
import { NETWORK_FIT, useMapFit, type FitTarget } from "./fit";
import type { LngLatTuple } from "./geo";
import { hubLngLat, useMapHubs, type MapHub } from "./hubs";

/** Origins at or above this share of regional pings are kept in view when a hub is selected. */
export const FIT_MIN_SHARE_PCT = 2;

/** A lone hub: its catchment with room around it (at least 2.5 km), so the neighbourhood stays readable. */
export function hubFitTarget(hub: MapHub): FitTarget {
  return {
    key: `hub:${hub.id}`,
    points: [hubLngLat(hub)],
    minRadiusM: Math.max(hub.catchment_m * 3, 2500),
  };
}

/** The previewed trip's movement plan, or null when the trip has no plan yet (the camera stays put). */
export function tripFitTarget(trip: AdditionalTrip): FitTarget | null {
  const plan = trip.movement_plan;
  if (!plan) return null;
  const points = [plan.deadhead, plan.service, plan.return_leg].flatMap((leg) => leg.path.coordinates as LngLatTuple[]);
  if (points.length === 0) return null;
  return { key: `preview:${trip.id}`, points, minRadiusM: 800, extraPadding: 40 };
}

function useCameraTarget(): FitTarget {
  const hubs = useMapHubs();
  const selectedHubId = useSim((s) => s.selectedHubId);
  const previewTrip = useSim((s) => (s.previewTripId ? s.trips[s.previewTripId] : undefined));
  const originsOn = useSim((s) => s.layers.includes("origins"));
  const origins = useOriginMix(originsOn ? selectedHubId : null);
  // The points follow the hourly mix, but the key doesn't, so the camera only moves when the hub changes.
  const points = useMemo(
    () =>
      origins?.mix.regional
        .filter((r) => r.location && (r.share_of_local_pct ?? 0) >= FIT_MIN_SHARE_PCT)
        .map((r): LngLatTuple => [r.location!.lon, r.location!.lat]) ?? [],
    [origins],
  );
  return useMemo(() => {
    const preview = previewTrip ? tripFitTarget(previewTrip) : null;
    if (preview) return preview;
    const hub = selectedHubId ? hubs.find((h) => h.id === selectedHubId) : undefined;
    if (!hub) return NETWORK_FIT;
    const base = hubFitTarget(hub);
    if (points.length === 0) return base;
    return { ...base, key: `${base.key}:origins`, points: [hubLngLat(hub), ...points], extraPadding: 40 };
  }, [hubs, selectedHubId, points, previewTrip]);
}

export function CameraController({ container, occludedRight }: { container: HTMLElement | null; occludedRight: number }) {
  useMapFit(useCameraTarget(), container, occludedRight);
  return null;
}
