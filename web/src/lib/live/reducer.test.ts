import { describe, expect, it } from "vitest";
import { applyMessage, applyMessages, applySnapshot, emptySim, type SimSlice } from "./reducer";
import { BUS, CLOCK, HUB, SURGE, TRIP, makeState, msg } from "./__tests__/fixtures";

const WALL = 1_000_000;
const synced = (): SimSlice => applySnapshot(emptySim, makeState(), WALL);

describe("applySnapshot", () => {
  it("replaces everything and indexes entities by id", () => {
    const s = applySnapshot({ ...emptySim, resyncing: true }, makeState(), WALL);
    expect(s.epoch).toBe(3);
    expect(s.lastSeq).toBe(1042);
    expect(s.clock).toEqual(CLOCK);
    expect(s.receivedAt).toBe(WALL);
    expect(s.surges[SURGE.id]).toEqual(SURGE);
    expect(s.trips[TRIP.id]).toEqual(TRIP);
    expect(s.buses[BUS.id]).toEqual(BUS);
    expect(s.hubs.ubc).toEqual(HUB);
    expect(s.resyncing).toBe(false);
    expect(s.lastSimTime).toBe(CLOCK.current_time);
  });

  it("applies a lower epoch too (the server restarted)", () => {
    const s = applySnapshot(synced(), makeState({ epoch: 1, last_seq: 5 }), WALL);
    expect(s.epoch).toBe(1);
    expect(s.lastSeq).toBe(5);
  });
});

describe("seq and epoch filtering", () => {
  const hub = { ...HUB, active_trip_count: 9 };

  it("applies the next seq and advances lastSeq and lastSimTime", () => {
    const { sim } = applyMessage(synced(), msg("hub.demand_updated", hub, 1043, 3, "2025-12-06T11:00:00-08:00"), WALL);
    expect(sim.hubs.ubc.active_trip_count).toBe(9);
    expect(sim.lastSeq).toBe(1043);
    expect(sim.lastSimTime).toBe("2025-12-06T11:00:00-08:00");
  });

  it("drops seq at or below lastSeq", () => {
    const s = synced();
    expect(applyMessage(s, msg("hub.demand_updated", hub, 1042), WALL).sim).toBe(s);
    expect(applyMessage(s, msg("hub.demand_updated", hub, 900), WALL).sim).toBe(s);
  });

  it("drops messages from an older epoch, whatever their seq", () => {
    const s = synced();
    const result = applyMessage(s, msg("hub.demand_updated", hub, 5000, 2), WALL);
    expect(result.sim).toBe(s);
    expect(result.effects).toEqual([]);
  });

  it("treats a message from a newer epoch as a missed reset and hands it back", () => {
    const s = synced();
    const newer = msg("hub.demand_updated", hub, 1, 4);
    const later = msg("hub.demand_updated", hub, 2, 4);
    const result = applyMessages(s, [newer, later], WALL);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
    expect(result.sim.resyncing).toBe(true);
    expect(result.sim.hubs.ubc.active_trip_count).toBe(HUB.active_trip_count);
    expect(result.remaining).toEqual([newer, later]);
  });
});

describe("state.reset", () => {
  it("sets resyncing and emits reset when its data.epoch is newer, regardless of seq", () => {
    const result = applyMessage(synced(), msg("state.reset", { epoch: 4, reason: "SEEK" }, 1, 4), WALL);
    expect(result.sim.resyncing).toBe(true);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
  });

  it("is ignored when we already have that epoch", () => {
    const s = synced();
    const result = applyMessage(s, msg("state.reset", { epoch: 3, reason: "SEEK" }, 2000), WALL);
    expect(result.sim).toBe(s);
    expect(result.effects).toEqual([]);
  });

  it("stops a batch; the messages after it wait for the next snapshot", () => {
    const tick = msg("simulation.tick", { current_time: "2025-12-06T10:05:00-08:00", local_date: "2025-12-06", hour: 10 }, 1043);
    const reset = msg("state.reset", { epoch: 4, reason: "SEEK" }, 1044, 4);
    const after = msg("hub.demand_updated", HUB, 1045, 4);
    const result = applyMessages(synced(), [tick, reset, after], WALL);
    expect(result.sim.clock?.current_time).toBe("2025-12-06T10:05:00-08:00");
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
    expect(result.remaining).toEqual([after]);
  });
});

describe("clock", () => {
  it("simulation.tick moves the time fields and receivedAt, keeping the rest", () => {
    const tick = msg("simulation.tick", { current_time: "2025-12-06T11:00:00-08:00", local_date: "2025-12-06", hour: 11 }, 1043);
    const { sim } = applyMessage(synced(), tick, WALL + 500);
    expect(sim.clock).toEqual({ ...CLOCK, current_time: "2025-12-06T11:00:00-08:00", hour: 11 });
    expect(sim.receivedAt).toBe(WALL + 500);
  });

  it("simulation.tick doesn't roll back a clock from a newer epoch (a seek response)", () => {
    const s = { ...synced(), clock: { ...CLOCK, epoch: 4, current_time: "2026-02-11T13:00:00-08:00" } };
    const tick = msg("simulation.tick", { current_time: "2025-12-06T10:01:00-08:00", local_date: "2025-12-06", hour: 10 }, 1043);
    const { sim } = applyMessage(s, tick, WALL);
    expect(sim.clock?.current_time).toBe("2026-02-11T13:00:00-08:00");
    expect(sim.lastSeq).toBe(1043);
  });

  it("simulation.state_changed replaces the clock", () => {
    const changed = msg("simulation.state_changed", { ...CLOCK, status: "RUNNING", speed: 300, reason: "RESUMED" }, 1043);
    const { sim, effects } = applyMessage(synced(), changed, WALL + 10);
    expect(sim.clock).toEqual({ ...CLOCK, status: "RUNNING", speed: 300 });
    expect(sim.receivedAt).toBe(WALL + 10);
    expect(effects).toEqual([]);
  });

  it("an auto-pause emits auto-paused", () => {
    const changed = msg("simulation.state_changed", { ...CLOCK, reason: "AUTO_PAUSE_PROPOSAL" }, 1043);
    expect(applyMessage(synced(), changed, WALL).effects).toEqual([{ kind: "auto-paused" }]);
  });
});

describe("entity upserts", () => {
  it("surge.updated replaces the whole surge", () => {
    const updated = { ...SURGE, status: "DISPATCHED" as const };
    const { sim } = applyMessage(synced(), msg("surge.updated", updated, 1043), WALL);
    expect(sim.surges[SURGE.id]).toEqual(updated);
  });

  it.each(["dispatch.approved", "dispatch.rejected", "trip.updated"] as const)("%s replaces the trip", (type) => {
    const updated = { ...TRIP, status: "APPROVED" as const };
    const { sim } = applyMessage(synced(), msg(type, updated, 1043), WALL);
    expect(sim.trips[TRIP.id]).toEqual(updated);
  });

  it("bus.updated replaces the bus", () => {
    const updated = { ...BUS, status: "DEADHEADING" as const, assigned_trip_id: TRIP.id };
    const { sim } = applyMessage(synced(), msg("bus.updated", updated, 1043), WALL);
    expect(sim.buses[BUS.id]).toEqual(updated);
  });

  it("bus.positions_updated merges location, heading and status into known buses", () => {
    const positions = {
      positions: [
        { bus_id: BUS.id, location: { lat: 49.26, lon: -123.2 }, heading_deg: 270, status: "DEADHEADING" as const },
        { bus_id: "bus-unknown", location: { lat: 49.3, lon: -123.1 }, heading_deg: 0, status: "AVAILABLE" as const },
      ],
    };
    const { sim } = applyMessage(synced(), msg("bus.positions_updated", positions, 1043), WALL);
    expect(sim.buses[BUS.id]).toEqual({
      ...BUS,
      location: { lat: 49.26, lon: -123.2 },
      heading_deg: 270,
      status: "DEADHEADING",
    });
    expect(sim.buses["bus-unknown"]).toBeUndefined();
  });
});

describe("effects", () => {
  const newSurge = { ...SURGE, id: "surge-999" };

  it("a surge id seen for the first time emits surge-new once", () => {
    const first = applyMessage(synced(), msg("surge.updated", newSurge, 1043), WALL);
    expect(first.effects).toEqual([{ kind: "surge-new", surge: newSurge }]);
    const again = applyMessage(first.sim, msg("surge.updated", { ...newSurge, status: "DISPATCHED" }, 1044), WALL);
    expect(again.effects).toEqual([]);
  });

  it("a surge already in the snapshot is not new", () => {
    expect(applyMessage(synced(), msg("surge.updated", SURGE, 1043), WALL).effects).toEqual([]);
  });

  it("a surge first seen already resolved is not announced", () => {
    const resolved = { ...newSurge, phase: "RESOLVED" as const, actual: { pings: 4912, surge_index: 1.88 } };
    expect(applyMessage(synced(), msg("surge.updated", resolved, 1043), WALL).effects).toEqual([]);
  });

  it("dispatch.proposed emits trip-proposed for a new proposal", () => {
    const trip = { ...TRIP, id: "trip-789" };
    expect(applyMessage(synced(), msg("dispatch.proposed", trip, 1043), WALL).effects).toEqual([
      { kind: "trip-proposed", trip },
    ]);
  });

  it("a trip entering EXPIRED emits trip-expired once", () => {
    const expired = { ...TRIP, status: "EXPIRED" as const };
    const first = applyMessage(synced(), msg("trip.updated", expired, 1043), WALL);
    expect(first.effects).toEqual([{ kind: "trip-expired", trip: expired }]);
    expect(applyMessage(first.sim, msg("trip.updated", expired, 1044), WALL).effects).toEqual([]);
  });
});
