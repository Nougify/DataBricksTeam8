import { describe, expect, it } from "vitest";
import { MovementPlan } from "@/lib/api/schemas";
import { BUS, TRIP } from "@/lib/live/__tests__/fixtures";
import { projectBusPosition } from "./busProjection";

const provenance = { provider: "test", is_approximation: false, method: "fixture", speed_kph: null };
const plan = MovementPlan.parse({
  route_id: "route-99",
  pattern_id: "pattern-99",
  source_stop_id: "ubc",
  destination_stop_id: "commercial",
  reference_scheduled_trip_id: "scheduled-99",
  mode: "PROACTIVE",
  deadhead: { kind: "DEADHEAD", path: { type: "LineString", coordinates: [[-123.25, 49.26], [-123.24, 49.27]] }, distance_m: 1000, duration_seconds: 600, provenance },
  service: { kind: "SERVICE", path: { type: "LineString", coordinates: [[0, 1], [1, 1], [3, 1]] }, distance_m: 3000, duration_seconds: 2400, provenance },
  return_leg: { kind: "RETURN", path: { type: "LineString", coordinates: [[3, 1], [0, 1]] }, distance_m: 3000, duration_seconds: 1800, provenance },
  dispatch_time: "2025-12-06T10:00:00-08:00",
  estimated_arrival_time: "2025-12-06T10:10:00-08:00",
  service_departure_time: "2025-12-06T10:20:00-08:00",
  estimated_completion_time: "2025-12-06T11:00:00-08:00",
  estimated_return_time: "2025-12-06T11:30:00-08:00",
  waiting_seconds: 600,
  arrival_lateness_seconds: 0,
  total_distance_m: 7000,
});
const trip = { ...TRIP, status: "APPROVED" as const, movement_plan: plan };
const assigned = { ...BUS, assigned_trip_id: TRIP.id, proposed_trip_id: null };

describe("projectBusPosition", () => {
  it("moves distance-weighted along an active service path", () => {
    const result = projectBusPosition(
      { ...assigned, status: "IN_SERVICE" },
      trip,
      Date.parse("2025-12-06T10:50:00-08:00"),
    );
    expect(result.location.lon).toBeCloseTo(2.25, 3);
    expect(result.location.lat).toBeCloseTo(1, 6);
    expect(result.heading_deg).not.toBeNull();
  });

  it("holds a waiting bus at the deadhead endpoint", () => {
    const result = projectBusPosition({ ...assigned, status: "WAITING" }, trip, Date.now());
    expect(result.location).toEqual({ lon: -123.24, lat: 49.27 });
  });

  it("keeps persisted state without the matching assigned trip", () => {
    expect(projectBusPosition(BUS, trip, Date.now())).toEqual({
      location: BUS.location,
      heading_deg: BUS.heading_deg,
    });
  });
});
