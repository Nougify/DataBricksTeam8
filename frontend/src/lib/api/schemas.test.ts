// Every JSON example in message.txt parses against schemas.ts, and parsing drops nothing (an example
// field the schema doesn't know would be stripped, so the round trip would differ).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as S from "./schemas";
import * as composed from "./__fixtures__/composed";
import additionalTrip from "./__fixtures__/additional-trip.json";
import approveBody from "./__fixtures__/approve-body.json";
import backtest from "./__fixtures__/backtest.json";
import bus from "./__fixtures__/bus.json";
import clock from "./__fixtures__/clock.json";
import events from "./__fixtures__/events.json";
import findings from "./__fixtures__/findings.json";
import forecast from "./__fixtures__/forecast.json";
import hourlyProfile from "./__fixtures__/hourly-profile.json";
import hubStatus from "./__fixtures__/hub-status.json";
import hubs from "./__fixtures__/hubs.json";
import meta from "./__fixtures__/meta.json";
import origins from "./__fixtures__/origins.json";
import overview from "./__fixtures__/overview.json";
import recommendations from "./__fixtures__/recommendations.json";
import rejectBody from "./__fixtures__/reject-body.json";
import retiredEvents from "./__fixtures__/retired-events.json";
import routeDetail from "./__fixtures__/route-detail.json";
import routeRef from "./__fixtures__/route-ref.json";
import routes from "./__fixtures__/routes.json";
import seekBody from "./__fixtures__/seek-body.json";
import settingsBody from "./__fixtures__/settings-body.json";
import speedBody from "./__fixtures__/speed-body.json";
import surge from "./__fixtures__/surge.json";
import timeline from "./__fixtures__/timeline.json";
import validation from "./__fixtures__/validation.json";
import wsEnvelope from "./__fixtures__/ws-envelope.json";
import { BUS, CLOCK, EVENT as DISPATCH_EVENT, TRIP } from "@/lib/live/__tests__/fixtures";

function expectExample(schema: z.ZodType, example: unknown) {
  const result = schema.safeParse(example);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  expect(result.data).toEqual(example);
}

describe("§0.1 shared objects", () => {
  it.each([
    ["RouteRef", S.RouteRef, routeRef],
    ["Clock", S.Clock, clock],
    ["HubStatus", S.HubStatus, hubStatus],
    ["Surge", S.Surge, surge],
    ["Bus", S.Bus, bus],
    ["AdditionalTrip", S.AdditionalTrip, TRIP],
  ] as const)("%s", (_name, schema, example) => expectExample(schema, example));
});

describe("§1–§11b simulation, trips and routes", () => {
  it("v3 GET /state retains operational entities", () => {
    const state = { epoch: 3, last_seq: 1042, simulation: CLOCK, dispatch_events: [DISPATCH_EVENT], buses: [BUS], additional_trips: [TRIP] };
    expectExample(S.StateResponse, state);
  });
  it("§2 GET /surges", () => expectExample(S.SurgeList, composed.surgeList));
  it("§3 GET /buses", () => expectExample(S.BusList, composed.busList));
  it("v3 GET /additional-trips", () => expectExample(S.TripList, [TRIP]));
  it("v3 GET /additional-trips/{id}", () => expectExample(S.AdditionalTripDetail, TRIP));
  it("§6 GET /routes", () => expectExample(S.RouteList, routes));
  it("§7 GET /routes/{id}", () => expectExample(S.RouteDetail, routeDetail));

  it.each(Object.entries(composed.clockResponses))("Clock response: %s", (_name, example) =>
    expectExample(S.Clock, example),
  );

  it("§8b seek body", () => expectExample(S.SeekBody, seekBody));
  it("§9 speed body", () => expectExample(S.SpeedBody, speedBody));
  it("§9b approve body", () => expectExample(S.ApproveBody, approveBody));
  it("§9b reject body", () => expectExample(S.RejectBody, rejectBody));
  it("§11b settings body", () => expectExample(S.SettingsBody, settingsBody));
});

describe("§13–§28 read endpoints", () => {
  it.each([
    ["§13 /meta", S.Meta, meta],
    ["§14 /hubs", S.HubList, hubs],
    ["§15 /hubs/{id}/status", S.HubStatus, hubStatus],
    ["§16 /hubs/{id}/forecast", S.Forecast, forecast],
    ["§17 /hubs/{id}/origins", S.Origins, origins],
    ["§18 /timeline", S.Timeline, timeline],
    ["§19 /events", S.EventList, events],
    ["§20 /routes/load (composed)", S.RouteLoadList, composed.routeLoad],
    ["§21 /hubs/{id}/late-night (composed)", S.LateNight, composed.lateNight],
    ["§22 /hubs/{id}/hourly-profile", S.HourlyProfile, hourlyProfile],
    ["§23 /hubs/{id}/overview", S.Overview, overview],
    ["§24 /hubs/{id}/route-crowding (composed)", S.RouteCrowding, composed.routeCrowding],
    ["§25 /hubs/{id}/recommendations", S.RecommendationList, recommendations],
    ["§26 /findings", S.Findings, findings],
    ["§27 /backtest", S.Backtest, backtest],
    ["§28 /validation", S.Validation, validation],
  ] as const)("%s", (_name, schema, example) => expectExample(schema, example));
});

describe("§12 WebSocket", () => {
  const envelope = (type: string, data: unknown) => ({
    type,
    seq: 1043,
    epoch: 3,
    simulation_time: "2025-12-06T10:00:00-08:00",
    data,
  });

  it("the envelope example parses as an Envelope", () => expectExample(S.Envelope, wsEnvelope));

  // One message per backend EventType.
  const events: [string, unknown][] = [
    ["clock.updated", { ...clock, reason: null }],
    ["dispatch_event.updated", DISPATCH_EVENT],
    ["proposal.created", TRIP],
    ["proposal.updated", { ...TRIP, status: "APPROVED" }],
    ["trip.updated", { ...TRIP, status: "BUS_EN_ROUTE" }],
    ["bus.updated", bus],
    ["system.reset", { epoch: 4, reason: "SEEK" }],
    ["system.error", { message: "Source unavailable" }],
  ];

  it.each(events)("%s parses through WsMessage", (type, data) => expectExample(S.WsMessage, envelope(type, data)));

  it("KNOWN_WS_TYPES is exactly the §12 table", () => {
    expect([...S.KNOWN_WS_TYPES].sort()).toEqual(events.map(([type]) => type).sort());
  });

  it("rejects retired v2 events", () => {
    for (const type of ["simulation.tick", "state.reset", "surge.updated", "dispatch.proposed", "bus.positions_updated", "hub.demand_updated"]) {
      expect(S.KNOWN_WS_TYPES.has(type)).toBe(false);
    }
  });
});
