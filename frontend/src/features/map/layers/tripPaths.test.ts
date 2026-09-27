import { describe, expect, it } from "vitest";
import type { AdditionalTrip, MovementPlan } from "@/lib/api/schemas";
import { tripPathFeatures } from "./tripPaths";

const path = (x: number) => ({ type: "LineString" as const, coordinates: [[x, 49], [x + 0.01, 49.01]] as [number, number][] });
const plan: MovementPlan = {
  route_id: "route-1",
  pattern_id: "pattern-1",
  source_stop_id: "source",
  destination_stop_id: "destination",
  reference_scheduled_trip_id: "scheduled-1",
  mode: "PROACTIVE",
  deadhead: { kind: "DEADHEAD", path: path(-123.2), distance_m: 1000, duration_seconds: 100, provenance: { provider: "test", is_approximation: false, method: "test", speed_kph: null } },
  service: { kind: "SERVICE", path: path(-123.1), distance_m: 2000, duration_seconds: 200, provenance: { provider: "test", is_approximation: false, method: "test", speed_kph: null } },
  return_leg: { kind: "RETURN", path: path(-123), distance_m: 1000, duration_seconds: 100, provenance: { provider: "test", is_approximation: false, method: "test", speed_kph: null } },
  dispatch_time: "2025-12-06T10:00:00-08:00",
  estimated_arrival_time: "2025-12-06T10:10:00-08:00",
  service_departure_time: "2025-12-06T10:10:00-08:00",
  estimated_completion_time: "2025-12-06T10:30:00-08:00",
  estimated_return_time: "2025-12-06T10:40:00-08:00",
  waiting_seconds: 0,
  arrival_lateness_seconds: 0,
  total_distance_m: 4000,
};

const trip = (id: string, status: AdditionalTrip["status"]): AdditionalTrip => ({
  id,
  status,
  movement_plan: plan,
  dispatch_event_id: "event-1",
  bus_id: `bus-${id}`,
  route_id: "route-1",
  proposed_at: "2025-12-06T09:00:00-08:00",
  approval_expires_at: "2025-12-06T09:10:00-08:00",
  dispatch_time: null,
  target_event_time: "2025-12-06T10:00:00-08:00",
  estimated_arrival_time: null,
  service_departure_time: null,
  estimated_completion_time: null,
  added_capacity: 77,
  rationale: "Test trip",
  source_priority: 1,
  source_route: null,
  destination: null,
  selected_candidate: null,
});

describe("tripPathFeatures", () => {
  it("shows only the previewed proposal and dims unrelated active paths", () => {
    const features = tripPathFeatures([trip("preview", "PROPOSED"), trip("other-proposal", "PROPOSED"), trip("active", "IN_SERVICE")], "preview", null, new Set());

    expect(features).toHaveLength(6);
    expect(new Set(features.map((feature) => feature.properties.leg_kind))).toEqual(new Set(["DEADHEAD", "SERVICE", "RETURN"]));
    expect(features.filter((feature) => feature.properties.trip_id === "preview").every((feature) => feature.properties.opacity === 1 && feature.properties.emphasized)).toBe(true);
    expect(features.filter((feature) => feature.properties.trip_id === "active").every((feature) => feature.properties.opacity === 0.2)).toBe(true);
    expect(features.some((feature) => feature.properties.trip_id === "other-proposal")).toBe(false);
  });

  it("keeps a completed path only while its bus is linked", () => {
    expect(tripPathFeatures([trip("done", "COMPLETED")], null, null, new Set())).toEqual([]);
    expect(tripPathFeatures([trip("done", "COMPLETED")], null, null, new Set(["done"]))).toHaveLength(3);
  });
});
