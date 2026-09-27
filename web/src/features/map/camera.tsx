"use client";

// Decides what the camera should show and hands it to useMapFit. Later milestones extend `useCameraTarget`:
//   M2: a selected hub also covers its origins with share ≥ 2% → key `hub:<id>:origins` once they've loaded.
//   M3: preview covers deadhead_path + service_path + donor and target routes → key `preview:<tripId>`.
import { useMemo } from "react";
import { useSim } from "@/lib/live/store";
import { NETWORK_FIT, useMapFit, type FitTarget } from "./fit";
import { hubLngLat, useMapHubs, type MapHub } from "./hubs";

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
  return useMemo(() => {
    const hub = selectedHubId ? hubs.find((h) => h.id === selectedHubId) : undefined;
    return hub ? hubFitTarget(hub) : NETWORK_FIT;
  }, [hubs, selectedHubId]);
}

export function CameraController({ container, occludedRight }: { container: HTMLElement | null; occludedRight: number }) {
  useMapFit(useCameraTarget(), container, occludedRight);
  return null;
}
