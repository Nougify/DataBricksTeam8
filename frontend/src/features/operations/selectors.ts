import type { AdditionalTrip, Bus, DispatchEvent } from "@/lib/api/schemas";

export interface OperationsData {
  events: DispatchEvent[];
  proposals: AdditionalTrip[];
  trips: AdditionalTrip[];
  buses: Bus[];
  counts: {
    events: number;
    proposals: number;
    activeTrips: number;
    availableBuses: number;
  };
}

const ACTIVE_TRIP_STATUSES = new Set<AdditionalTrip["status"]>(["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE"]);

const byEventTime = (a: DispatchEvent, b: DispatchEvent) =>
  Date.parse(a.event_time) - Date.parse(b.event_time) || b.priority_score - a.priority_score;

const byTripTime = (a: AdditionalTrip, b: AdditionalTrip) =>
  Date.parse(b.proposed_at) - Date.parse(a.proposed_at) || a.id.localeCompare(b.id);

/** Derives every Operations panel list without manufacturing hub ownership for fleet vehicles. */
export function selectOperations(
  dispatchEvents: Record<string, DispatchEvent>,
  tripsById: Record<string, AdditionalTrip>,
  busesById: Record<string, Bus>,
  hubId: string | null,
): OperationsData {
  const events = Object.values(dispatchEvents).filter((event) => !hubId || event.hub_id === hubId).sort(byEventTime);
  const eventIds = new Set(events.map((event) => event.id));
  const trips = Object.values(tripsById).filter((trip) => eventIds.has(trip.dispatch_event_id)).sort(byTripTime);
  const proposals = trips.filter((trip) => trip.status === "PROPOSED");
  const buses = Object.values(busesById).sort((a, b) => a.id.localeCompare(b.id));

  return {
    events,
    proposals,
    trips,
    buses,
    counts: {
      events: events.length,
      proposals: proposals.length,
      activeTrips: trips.filter((trip) => ACTIVE_TRIP_STATUSES.has(trip.status)).length,
      availableBuses: buses.filter((bus) => bus.status === "AVAILABLE").length,
    },
  };
}
