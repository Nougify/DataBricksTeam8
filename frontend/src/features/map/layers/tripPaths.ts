import type { Feature, LineString } from "geojson";
import type { AdditionalTrip, Bus, MovementLeg } from "@/lib/api/schemas";
import { DIM_FACTOR } from "../dim";

export interface TripPathProperties {
  trip_id: string;
  leg_kind: MovementLeg["kind"];
  preview: boolean;
  emphasized: boolean;
  opacity: number;
  width: number;
}

export type TripPathFeature = Feature<LineString, TripPathProperties>;

const ACTIVE_PATH_STATUSES = new Set<AdditionalTrip["status"]>([
  "APPROVED",
  "BUS_EN_ROUTE",
  "IN_SERVICE",
]);

const LEG_WIDTH: Record<MovementLeg["kind"], number> = {
  DEADHEAD: 3,
  SERVICE: 4,
  RETURN: 2.5,
};

/** Converts only operationally relevant v3 movement plans into map features. */
export function tripPathFeatures(
  trips: readonly AdditionalTrip[],
  previewTripId: string | null,
  focusTripId: string | null,
  linkedTripIds: ReadonlySet<string>,
): TripPathFeature[] {
  const features: TripPathFeature[] = [];

  for (const trip of trips) {
    const preview = trip.id === previewTripId;
    const focused = trip.id === focusTripId;
    const show = ACTIVE_PATH_STATUSES.has(trip.status) || preview || focused || (trip.status === "COMPLETED" && linkedTripIds.has(trip.id));
    if (!show || !trip.movement_plan) continue;

    const emphasized = preview || focused;
    const opacity = previewTripId && !preview ? DIM_FACTOR : 1;
    const legs = [trip.movement_plan.deadhead, trip.movement_plan.service, trip.movement_plan.return_leg];
    for (const leg of legs) {
      features.push({
        type: "Feature",
        id: `${trip.id}:${leg.kind}`,
        properties: {
          trip_id: trip.id,
          leg_kind: leg.kind,
          preview,
          emphasized,
          opacity,
          width: LEG_WIDTH[leg.kind] + (emphasized ? 2 : 0),
        },
        geometry: leg.path,
      });
    }
  }

  return features;
}

/** Ids of trips a bus is assigned to or proposed for. */
export function linkedTripIds(buses: Iterable<Bus>): Set<string> {
  const ids = new Set<string>();
  for (const bus of buses) {
    if (bus.assigned_trip_id) ids.add(bus.assigned_trip_id);
    if (bus.proposed_trip_id) ids.add(bus.proposed_trip_id);
  }
  return ids;
}
