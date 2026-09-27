import { describe, expect, it } from "vitest";
import { applyMessage, applyMessages, applySnapshot, emptySim, type SimSlice } from "./reducer";
import { BUS, CLOCK, EVENT, TRIP, makeState, msg } from "./__tests__/fixtures";

const WALL = 1_000_000;
const synced = (): SimSlice => applySnapshot(emptySim, makeState(), WALL);

describe("v3 live reducer", () => {
  it("indexes every authoritative snapshot entity without transforming it", () => {
    const state = makeState();
    const sim = applySnapshot(emptySim, state, WALL);
    expect(sim.dispatchEvents[EVENT.id]).toEqual(EVENT);
    expect(sim.trips[TRIP.id]).toEqual(TRIP);
    expect(sim.buses[BUS.id]).toEqual(BUS);
    expect(sim.lastSeq).toBe(state.last_seq);
  });

  it("upserts dispatch events, proposals, trips, buses, and clocks", () => {
    let sim = synced();
    const event = { ...EVENT, status: "DISPATCHED" as const };
    sim = applyMessage(sim, msg("dispatch_event.updated", event, 1043), WALL).sim;
    expect(sim.dispatchEvents[EVENT.id]).toEqual(event);

    const proposal = { ...TRIP, id: "trip-new" };
    const proposed = applyMessage(sim, msg("proposal.created", proposal, 1044), WALL);
    expect(proposed.effects).toEqual([{ kind: "trip-proposed", trip: proposal }]);
    sim = proposed.sim;

    const expired = { ...proposal, status: "EXPIRED" as const };
    const updated = applyMessage(sim, msg("proposal.updated", expired, 1045), WALL);
    expect(updated.effects).toEqual([{ kind: "trip-expired", trip: expired }]);
    sim = updated.sim;

    const bus = { ...BUS, status: "DEADHEADING" as const, proposed_trip_id: null, assigned_trip_id: proposal.id };
    sim = applyMessage(sim, msg("bus.updated", bus, 1046), WALL).sim;
    expect(sim.buses[BUS.id]).toEqual(bus);

    const clock = { ...CLOCK, status: "RUNNING" as const, reason: "RESUMED" as const };
    sim = applyMessage(sim, msg("clock.updated", clock, 1047), WALL + 10).sim;
    expect(sim.clock).toEqual({ ...CLOCK, status: "RUNNING" });
    expect(sim.receivedAt).toBe(WALL + 10);
  });

  it("drops stale messages and resyncs on a sequence gap", () => {
    const sim = synced();
    expect(applyMessage(sim, msg("bus.updated", BUS, 1042), WALL).sim).toBe(sim);
    const gap = msg("bus.updated", BUS, 1044);
    const result = applyMessages(sim, [gap], WALL);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 3 }]);
    expect(result.remaining).toEqual([gap]);
    expect(result.sim.resyncing).toBe(true);
  });

  it("stops at system.reset and buffers following events", () => {
    const reset = msg("system.reset", { epoch: 4, reason: "SEEK" }, 1, 4);
    const after = msg("bus.updated", BUS, 2, 4);
    const result = applyMessages(synced(), [reset, after], WALL);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
    expect(result.remaining).toEqual([after]);
  });
});
