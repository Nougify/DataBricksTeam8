import { describe, expect, it } from "vitest";
import type { Bus, DispatchEvent } from "@/lib/api/schemas";
import { BUS, EVENT, TRIP } from "@/lib/live/__tests__/fixtures";
import { selectOperations } from "./selectors";

describe("selectOperations", () => {
  const waterfrontEvent: DispatchEvent = { ...EVENT, id: "event-waterfront", hub_id: "waterfront" };
  const availableBus: Bus = {
    ...BUS,
    id: "bus-available",
    status: "AVAILABLE",
    assigned_trip_id: null,
    proposed_trip_id: null,
  };

  it("filters events and joined trips by hub and calculates operational counts", () => {
    const activeTrip = { ...TRIP, id: "trip-active", dispatch_event_id: waterfrontEvent.id, status: "IN_SERVICE" as const };
    const result = selectOperations(
      { [EVENT.id]: EVENT, [waterfrontEvent.id]: waterfrontEvent },
      { [TRIP.id]: TRIP, [activeTrip.id]: activeTrip },
      { [BUS.id]: BUS, [availableBus.id]: availableBus },
      "ubc",
    );

    expect(result.events.map((event) => event.id)).toEqual([EVENT.id]);
    expect(result.trips.map((trip) => trip.id)).toEqual([TRIP.id]);
    expect(result.proposals.map((trip) => trip.id)).toEqual([TRIP.id]);
    expect(result.counts).toEqual({ events: 1, proposals: 1, activeTrips: 0, availableBuses: 1 });
  });

  it("keeps fleet network-wide because buses do not carry a hub id", () => {
    const result = selectOperations(
      { [EVENT.id]: EVENT },
      { [TRIP.id]: TRIP },
      { [BUS.id]: BUS, [availableBus.id]: availableBus },
      "waterfront",
    );

    expect(result.events).toEqual([]);
    expect(result.trips).toEqual([]);
    expect(result.buses.map((bus) => bus.id)).toEqual([availableBus.id, BUS.id].sort());
    expect(result.counts.availableBuses).toBe(1);
  });

  it("orders events chronologically and trips newest first", () => {
    const laterEvent = { ...EVENT, id: "event-later", event_time: "2025-12-06T12:00:00-08:00" };
    const laterTrip = { ...TRIP, id: "trip-later", proposed_at: "2025-12-06T10:05:00-08:00" };
    const result = selectOperations(
      { [laterEvent.id]: laterEvent, [EVENT.id]: EVENT },
      { [TRIP.id]: TRIP, [laterTrip.id]: laterTrip },
      {},
      null,
    );

    expect(result.events.map((event) => event.id)).toEqual([EVENT.id, laterEvent.id]);
    expect(result.trips.map((trip) => trip.id)).toEqual([laterTrip.id, TRIP.id]);
  });
});
