// MockSim mirrors the v3 backend's rules on the real bundled feed (spec §18.1, DECISIONS.md "MockSim (v3)").
import { describe, expect, it } from "vitest";
import * as S from "@/lib/api/schemas";
import { MockSim } from "./mockSim";
import { MockApiError, type MockFrame } from "./types";

const UBC_PRESET = "2025-12-06T07:30:00-08:00";
const WATERFRONT_PRESET = "2026-07-25T07:30:00-07:00";
const MIN = 60_000;

/** A MockSim on a fake wall clock, started at `start`, with every frame recorded. */
async function setup(start: string) {
  let wall = 0;
  const sim = new MockSim({ now: () => wall, startTime: start });
  await sim.whenReady();
  const frames: MockFrame[] = [];
  sim.connect((f) => frames.push(f));
  const messages = () => frames.slice(1) as S.WsMessage[];
  /** Runs the clock for `simMinutes` at the current speed (stops early on an auto-pause). */
  const run = (simMinutes: number) => {
    const speed = sim.getClock().speed;
    sim.resume();
    wall += (simMinutes * MIN) / speed;
    sim.step(wall);
  };
  const advanceWall = (ms: number) => {
    wall += ms;
    sim.step(wall);
  };
  return { sim, frames, messages, run, advanceWall };
}

const clockMs = (sim: MockSim) => Date.parse(sim.getClock().current_time);
/** The one proposal awaiting approval (earlier ones from the overnight episode have expired). */
const pending = (sim: MockSim) => {
  const open = sim.listTrips().filter((t) => t.status === "PROPOSED");
  expect(open).toHaveLength(1);
  return open[0];
};

describe("MockSim (v3)", () => {
  it("starts paused at the start time with the mirrored fleet, and every payload parses", async () => {
    const { sim, frames } = await setup(UBC_PRESET);
    const state = sim.getState();
    expect(S.StateResponse.safeParse(state).success).toBe(true);
    expect(S.StateResponse.safeParse(frames[0]).success).toBe(true);
    expect(state.simulation.current_time).toBe(UBC_PRESET);
    expect(state.simulation.status).toBe("PAUSED");
    expect(state.epoch).toBe(0);
    expect(state.buses.map((b) => [b.id, b.status, b.source?.depot_name])).toEqual([
      ["bus-01", "AVAILABLE", "UBC"],
      ["bus-02", "AVAILABLE", "UBC"],
      ["bus-03", "AVAILABLE", "Waterfront Station"],
    ]);
    expect(S.Meta.safeParse(sim.getMeta()).success).toBe(true);
    // Only events already actionable are visible.
    for (const e of state.dispatch_events) expect(Date.parse(e.actionable_at)).toBeLessThanOrEqual(clockMs(sim));
  });

  it("activates the UBC exam-weekend event at 08:00, proposes route 49 and auto-pauses", async () => {
    const { sim, messages, run } = await setup(UBC_PRESET);
    sim.setSpeed(3600);
    run(60);
    expect(sim.getClock().status).toBe("PAUSED");
    expect(sim.getClock().current_time).toBe("2025-12-06T08:00:00-08:00");

    const msgs = messages();
    for (const m of msgs) expect(S.WsMessage.safeParse(m).success, m.type).toBe(true);
    const created = msgs.filter((m) => m.type === "proposal.created" && (m.data as S.AdditionalTrip).status === "PROPOSED");
    expect(created).toHaveLength(1);
    const trip = created[0].data as S.AdditionalTrip;
    expect(trip.status).toBe("PROPOSED");
    expect(trip.source_route).toBe("49");
    expect(trip.destination).toBe("Surrey");
    expect(trip.target_event_time).toBe("2025-12-06T09:00:00-08:00");
    expect(trip.approval_expires_at).toBe("2025-12-06T08:30:00-08:00");
    expect(trip.bus_id).toBe("bus-01");
    const event = sim.getDispatchEvent(trip.dispatch_event_id)!;
    expect(event.status).toBe("AWAITING_APPROVAL");
    expect(event.mode).toBe("PROACTIVE");
    expect(event.surge_ratio).toBeCloseTo(603 / 364, 5);
    const last = msgs.at(-1)!;
    expect(last.type).toBe("clock.updated");
    expect((last.data as { reason: string }).reason).toBe("AUTO_PAUSE_PROPOSAL");
    // seq increases by one per message
    msgs.forEach((m, i) => expect(m.seq).toBe(i + 1));
  });

  it("approve → BUS_EN_ROUTE → IN_SERVICE → COMPLETED, then the bus returns home", async () => {
    const { sim, run } = await setup(UBC_PRESET);
    sim.setSpeed(3600);
    run(60);
    const proposal = pending(sim);
    const approved = sim.approve(proposal.id);
    expect(approved.status).toBe("BUS_EN_ROUTE");
    expect(approved.movement_plan?.service.path.coordinates.length).toBeGreaterThan(2);
    expect(sim.getBus(approved.bus_id)!.status).toBe("DEADHEADING");

    const plan = approved.movement_plan!;
    const until = (iso: string) => (Date.parse(iso) - clockMs(sim)) / MIN;
    // Other events at UBC keep proposing (and auto-pausing), so keep resuming until each milestone.
    const runUntil = (iso: string) => {
      for (let i = 0; i < 50 && clockMs(sim) < Date.parse(iso); i++) run(until(iso));
    };
    runUntil(plan.service_departure_time);
    expect(sim.getTrip(approved.id)!.status).toBe("IN_SERVICE");
    expect(sim.getBus(approved.bus_id)!.status).toBe("IN_SERVICE");
    runUntil(plan.estimated_completion_time);
    expect(sim.getTrip(approved.id)!.status).toBe("COMPLETED");
    expect(sim.getBus(approved.bus_id)!.status).toBe("RETURNING");
    runUntil(plan.estimated_return_time);
    const bus = sim.getBus(approved.bus_id)!;
    expect(["AVAILABLE", "RESERVED"]).toContain(bus.status);
    expect(bus.assigned_trip_id).toBeNull();
  });

  it("reject releases the bus; a second decision is a 409 with the backend's message", async () => {
    const { sim, run } = await setup(UBC_PRESET);
    sim.setSpeed(3600);
    run(60);
    const proposal = pending(sim);
    const rejected = sim.reject(proposal.id);
    expect(rejected.status).toBe("REJECTED");
    expect(sim.getBus(proposal.bus_id)!.status).toBe("AVAILABLE");
    expect(sim.getDispatchEvent(proposal.dispatch_event_id)!.status).toBe("REJECTED");
    expect(sim.reject(proposal.id).status).toBe("REJECTED"); // idempotent
    expect(() => sim.approve(proposal.id)).toThrow(new MockApiError(409, "HTTP_ERROR", "trip is not proposed"));
    expect(() => sim.approve("nope")).toThrow(MockApiError);
  });

  it("expiry only advances while the clock runs", async () => {
    const { sim, run, advanceWall } = await setup(UBC_PRESET);
    sim.setSpeed(3600);
    run(60);
    const proposal = pending(sim);
    advanceWall(10 * 60_000); // paused: nothing moves
    expect(sim.getTrip(proposal.id)!.status).toBe("PROPOSED");
    run(30);
    expect(sim.getTrip(proposal.id)!.status).toBe("EXPIRED");
    expect(sim.getBus(proposal.bus_id)!.proposed_trip_id).not.toBe(proposal.id);
  });

  it("skips rail recommendations: Waterfront's top pick is the Expo Line, so a bus route serving the hub wins", async () => {
    const { sim, run } = await setup(WATERFRONT_PRESET);
    sim.setSpeed(3600);
    run(60);
    const trip = pending(sim);
    const event = sim.getDispatchEvent(trip.dispatch_event_id)!;
    expect(event.recommendations[0].source_route).toBe("Expo Line");
    expect(event.recommendations[0].mapping_status).toBe("INVALID");
    expect(event.recommendations[0].failure_code).toBe("NO_DISPATCH_ELIGIBLE_PATTERN");
    const chosen = event.recommendations.find((r) => r.mapping_status === "RESOLVED")!;
    expect(trip.source_route).toBe(chosen.source_route);
    expect(trip.bus_id).toBe("bus-03"); // the bus already at Waterfront arrives first
  });

  it("seek is deterministic, emits system.reset with a new epoch, and replays recorded decisions", async () => {
    const { sim, run, messages } = await setup(UBC_PRESET);
    sim.setSpeed(3600);
    run(60);
    const proposal = pending(sim);
    sim.approve(proposal.id);
    run(90);

    const target = "2025-12-06T10:00:00-08:00";
    await sim.seek(target);
    const a = sim.getState();
    expect(a.epoch).toBe(1);
    expect(messages().at(-1)).toMatchObject({ type: "system.reset", epoch: 1, data: { epoch: 1, reason: "SEEK" } });
    await sim.seek(target);
    const b = sim.getState();
    expect({ ...b, epoch: 1, last_seq: 0, simulation: { ...b.simulation, epoch: 1 } }).toEqual({
      ...a,
      last_seq: 0,
    });
    // The approval at 08:00 is replayed: the same trip id is in service, not expired.
    expect(["BUS_EN_ROUTE", "IN_SERVICE", "COMPLETED"]).toContain(sim.getTrip(proposal.id)!.status);

    // Seeking back before the decision discards it permanently.
    await sim.seek("2025-12-06T07:45:00-08:00");
    await sim.seek(target);
    expect(sim.getTrip(proposal.id)!.status).toBe("EXPIRED");
  });

  it("rejects a seek outside the bounds like the backend", async () => {
    const { sim } = await setup(UBC_PRESET);
    await expect(sim.seek("2025-01-01T00:00:00-08:00")).rejects.toThrow("seek time must be within simulation bounds");
  });
});
