"use client";

// Decides what the camera should show and hands it to useMapFit. A preview or focused trip takes precedence over
// the selected hub so its complete movement plan stays visible.
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
  const previewTripId = useSim((s) => s.previewTripId);
  const focusTripId = useSim((s) => s.focusTripId);
  const trips = useSim((s) => s.trips);
  return useMemo(() => {
    const tripId = previewTripId ?? focusTripId;
    const plan = tripId ? trips[tripId]?.movement_plan : null;
    if (tripId && plan) {
      return {
        key: `${previewTripId ? "preview" : "trip"}:${tripId}`,
        points: [plan.deadhead, plan.service, plan.return_leg].flatMap((leg) => leg.path.coordinates),
      };
    }
    const hub = selectedHubId ? hubs.find((h) => h.id === selectedHubId) : undefined;
    return hub ? hubFitTarget(hub) : NETWORK_FIT;
  }, [hubs, selectedHubId, previewTripId, focusTripId, trips]);
}

export function CameraController({ container, occludedRight }: { container: HTMLElement | null; occludedRight: number }) {
  useMapFit(useCameraTarget(), container, occludedRight);
  return null;
}
