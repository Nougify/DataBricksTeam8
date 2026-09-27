"use client";

// Decides what the camera should show and hands it to useMapFit (spec §7.2):
//   network        → METRO_BOUNDS;
//   hub selected   → the hub plus its regional origins with a share of at least 2% → key `hub:<id>:origins` once the
//                    mix is ready (the key doesn't change with the hour or basis, so the view never jumps mid-play);
//   M3 preview     → deadhead_path + service_path + donor and target routes → key `preview:<tripId>`.
import { useMemo } from "react";
import { useOriginMix } from "@/features/hub/origins/useOriginMix";
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

function useCameraTarget(): FitTarget {
  const hubs = useMapHubs();
  const selectedHubId = useSim((s) => s.selectedHubId);
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
    const hub = selectedHubId ? hubs.find((h) => h.id === selectedHubId) : undefined;
    if (!hub) return NETWORK_FIT;
    const base = hubFitTarget(hub);
    if (points.length === 0) return base;
    return { ...base, key: `${base.key}:origins`, points: [hubLngLat(hub), ...points], extraPadding: 40 };
  }, [hubs, selectedHubId, points]);
}

export function CameraController({ container, occludedRight }: { container: HTMLElement | null; occludedRight: number }) {
  useMapFit(useCameraTarget(), container, occludedRight);
  return null;
}
