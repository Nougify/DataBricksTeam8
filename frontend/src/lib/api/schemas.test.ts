// The v3 schemas accept real backend payloads unchanged. The fixtures were captured from backend/ running in
// fixture mode (GET /meta, /state, /routes, /dispatch-events, /buses, POST approve, error bodies, and the WS
// bootstrap plus one or two frames of every event type). Parsing must drop nothing: a field the schema doesn't
// know would be stripped, so the round trip would differ.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as S from "./schemas";
import buses from "./__fixtures__/buses.json";
import clock from "./__fixtures__/clock.json";
import dispatchEvents from "./__fixtures__/dispatch-events.json";
import error400 from "./__fixtures__/error-400.json";
import error404 from "./__fixtures__/error-404.json";
import error409 from "./__fixtures__/error-409.json";
import meta from "./__fixtures__/meta.json";
import routes from "./__fixtures__/routes.json";
import stateLater from "./__fixtures__/state-later.json";
import state from "./__fixtures__/state.json";
import tripApproved from "./__fixtures__/trip-approved.json";
import wsMessages from "./__fixtures__/ws-messages.json";

function expectExample(schema: z.ZodType, example: unknown) {
  const result = schema.safeParse(example);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  expect(result.data).toEqual(example);
}

describe("REST responses", () => {
  it("GET /meta", () => expectExample(S.Meta, meta));
  it("GET /state with a proposal", () => expectExample(S.StateResponse, state));
  it("GET /state later (trips in several states)", () => expectExample(S.StateResponse, stateLater));
  it("POST /clock/* returns a Clock", () => expectExample(S.Clock, clock));
  it("GET /routes?include_shape=true", () => expectExample(S.RouteList, routes));
  it("GET /dispatch-events", () => expectExample(S.DispatchEventList, dispatchEvents));
  it("GET /buses", () => expectExample(S.BusList, buses));
  it("POST /additional-trips/{id}/approve", () => expectExample(S.AdditionalTrip, tripApproved));
  it.each([
    ["409", error409],
    ["404", error404],
    ["400", error400],
  ])("error body %s", (_code, body) => expectExample(S.ErrorBody, body));
});

describe("WebSocket", () => {
  const [bootstrap, ...events] = wsMessages as unknown[];

  it("the first frame is the /state snapshot", () => expectExample(S.StateResponse, bootstrap));

  it("covers every v3 event type", () => {
    const types = new Set(events.map((m) => (m as { type: string }).type));
    expect([...types].sort()).toEqual([...S.KNOWN_WS_TYPES].sort());
  });

  it.each(events.map((m) => [(m as { type: string }).type, m] as const))("%s", (_type, message) =>
    expectExample(S.WsMessage, message),
  );
});

describe("strictness", () => {
  it("rejects a Clock without a listed field", () => {
    const rest: Record<string, unknown> = { ...clock };
    delete rest.epoch;
    expect(S.Clock.safeParse(rest).success).toBe(false);
  });

  it("accepts a Clock without the backend's optional extras", () => {
    const rest: Record<string, unknown> = { ...clock };
    for (const key of ["local_date", "hour", "approval_mode", "auto_pause_on_proposal"]) delete rest[key];
    expect(S.Clock.safeParse(rest).success).toBe(true);
  });

  it("rejects a speed the contract doesn't allow", () => {
    expect(S.Clock.safeParse({ ...clock, speed: 120 }).success).toBe(false);
  });

  it("rejects an unknown trip status", () => {
    expect(S.AdditionalTrip.safeParse({ ...tripApproved, status: "DONE" }).success).toBe(false);
  });
});
