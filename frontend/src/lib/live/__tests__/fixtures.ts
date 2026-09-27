// Contract-valid v3 entities shared by live-layer tests.
import * as S from "@/lib/api/schemas";
import bus from "@/lib/api/__fixtures__/bus.json";
import clock from "@/lib/api/__fixtures__/clock.json";
import hubStatus from "@/lib/api/__fixtures__/hub-status.json";
import surge from "@/lib/api/__fixtures__/surge.json";

export const CLOCK = S.Clock.parse(clock); // 2025-12-06 10:00 PST, PAUSED, 60x, epoch 3
export const HUB = S.HubStatus.parse(hubStatus);
export const SURGE = S.Surge.parse(surge);
export const BUS = S.Bus.parse(bus);
export const EVENT = S.DispatchEvent.parse({
  id: "event-123",
  hub_id: "ubc",
  source_location: "UBC Exchange",
  location: { lat: 49.267, lon: -123.247 },
  available_at: "2025-12-06T09:45:00-08:00",
  actionable_at: "2025-12-06T09:45:00-08:00",
  event_time: "2025-12-06T11:00:00-08:00",
  mode: "PROACTIVE",
  surge_type: "forecast",
  predicted_people: 1200,
  normal_people: 700,
  surge_ratio: 1.71,
  suggested_extra_buses: 1,
  priority_score: 95,
  recommendations: [{
    destination: "Commercial-Broadway",
    destination_share: 35,
    route_id: "route-99",
    source_route: "99",
    extra_bus_trips_est: 1,
    priority_score: 95,
    scheduled_trips_that_hour: 8,
    extra_people_on_route: 420,
    avg_daily_boardings: 10000,
    pct_trips_overcrowded: 42,
    mapping_status: "RESOLVED",
    failure_code: null,
    failure_reason: null,
    candidates: [{
      route_id: "route-99",
      pattern_id: "pattern-99-east",
      source_stop_id: "stop-ubc",
      destination_stop_id: "stop-commercial",
      source_stop_sequence: 0,
      destination_stop_sequence: 12,
      direction_id: 0,
      requested_service_date: "2025-12-06",
      feed_service_date: "2025-12-06",
      representative_service: false,
      scheduled_trip_ids: ["scheduled-99-1"],
    }],
  }],
  status: "AWAITING_APPROVAL",
  additional_trip_ids: ["trip-456"],
  source: { split: "test", direction: "outbound", link: null, version: "v3", generated_at: "2025-12-06T09:40:00-08:00" },
});
export const TRIP = S.AdditionalTrip.parse({
  id: "trip-456",
  dispatch_event_id: EVENT.id,
  bus_id: BUS.id,
  route_id: "route-99",
  status: "PROPOSED",
  proposed_at: "2025-12-06T10:00:00-08:00",
  approval_expires_at: "2025-12-06T10:10:00-08:00",
  dispatch_time: null,
  target_event_time: EVENT.event_time,
  estimated_arrival_time: null,
  service_departure_time: null,
  estimated_completion_time: null,
  added_capacity: 77,
  rationale: "Forecast demand exceeds scheduled capacity.",
  source_priority: 95,
  source_route: "99",
  destination: "Commercial-Broadway",
  selected_candidate: EVENT.recommendations[0].candidates[0],
  movement_plan: null,
});

export function makeState(overrides: Partial<S.StateResponse> = {}): S.StateResponse {
  return {
    epoch: 3,
    last_seq: 1042,
    simulation: CLOCK,
    dispatch_events: [EVENT],
    buses: [BUS],
    additional_trips: [TRIP],
    ...overrides,
  };
}

type Data<T extends S.WsMessageType> = S.WsMessageOf<T>["data"];

export function msg<T extends S.WsMessageType>(
  type: T,
  data: Data<T>,
  seq: number,
  epoch = 3,
  simulationTime = "2025-12-06T10:00:00-08:00",
): S.WsMessageOf<T> {
  return { type, seq, epoch, simulation_time: simulationTime, data } as S.WsMessageOf<T>;
}
