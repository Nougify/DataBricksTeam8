import { describe, expect, it } from "vitest";
import { applyMessage, applyMessages, applySnapshot, emptySim, type SimSlice } from "./reducer";
import { BUS, CLOCK, EVENT, TRIP, makeState, msg, tick } from "./__tests__/fixtures";

const WALL = 1_000_000;
const synced = (): SimSlice => applySnapshot(emptySim, makeState(), WALL);

describe("applySnapshot", () => {
  it("replaces everything and indexes entities by id", () => {
    const s = applySnapshot({ ...emptySim, resyncing: true }, makeState(), WALL);
    expect(s.epoch).toBe(3);
    expect(s.lastSeq).toBe(1042);
    expect(s.clock).toEqual(CLOCK);
    expect(s.receivedAt).toBe(WALL);
    expect(s.events[EVENT.id]).toEqual(EVENT);
    expect(s.trips[TRIP.id]).toEqual(TRIP);
    expect(s.buses[BUS.id]).toEqual(BUS);
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
  const moved = { ...BUS, status: "DEADHEADING" as const };

  it("applies the next seq and advances lastSeq and lastSimTime", () => {
    const { sim } = applyMessage(synced(), msg("bus.updated", moved, 1043, 3, "2025-12-06T11:00:00-08:00"), WALL);
    expect(sim.buses[BUS.id].status).toBe("DEADHEADING");
    expect(sim.lastSeq).toBe(1043);
    expect(sim.lastSimTime).toBe("2025-12-06T11:00:00-08:00");
  });

  it("drops seq at or below lastSeq", () => {
    const s = synced();
    expect(applyMessage(s, msg("bus.updated", moved, 1042), WALL).sim).toBe(s);
    expect(applyMessage(s, msg("bus.updated", moved, 900), WALL).sim).toBe(s);
  });

  it("drops messages from an older epoch, whatever their seq", () => {
    const s = synced();
    const result = applyMessage(s, msg("bus.updated", moved, 5000, 2), WALL);
    expect(result.sim).toBe(s);
    expect(result.effects).toEqual([]);
  });

  it("treats a seq gap as missed messages: resync, and hand the message back", () => {
    const s = synced();
    const gap = msg("bus.updated", moved, 1045);
    const result = applyMessages(s, [gap], WALL);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 3 }]);
    expect(result.sim.resyncing).toBe(true);
    expect(result.sim.buses[BUS.id]).toEqual(BUS);
    expect(result.remaining).toEqual([gap]);
  });

  it("treats a message from a newer epoch as a missed reset and hands it back", () => {
    const s = synced();
    const newer = msg("bus.updated", moved, 1, 4);
    const later = msg("bus.updated", moved, 2, 4);
    const result = applyMessages(s, [newer, later], WALL);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
    expect(result.sim.resyncing).toBe(true);
    expect(result.sim.buses[BUS.id]).toEqual(BUS);
    expect(result.remaining).toEqual([newer, later]);
  });
});

describe("system.reset", () => {
  it("sets resyncing and emits reset when its data.epoch is newer, regardless of seq", () => {
    const result = applyMessage(synced(), msg("system.reset", { epoch: 4, reason: "SEEK" }, 1043, 4), WALL);
    expect(result.sim.resyncing).toBe(true);
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
  });

  it("is ignored when we already have that epoch", () => {
    const s = synced();
    const result = applyMessage(s, msg("system.reset", { epoch: 3, reason: "SEEK" }, 2000), WALL);
    expect(result.sim).toBe(s);
    expect(result.effects).toEqual([]);
  });

  it("stops a batch; the messages after it wait for the next snapshot", () => {
    const reset = msg("system.reset", { epoch: 4, reason: "SEEK" }, 1044, 4);
    const after = msg("bus.updated", BUS, 1045, 4);
    const result = applyMessages(synced(), [tick("2025-12-06T10:05:00-08:00", 1043), reset, after], WALL);
    expect(result.sim.clock?.current_time).toBe("2025-12-06T10:05:00-08:00");
    expect(result.effects).toEqual([{ kind: "reset", epoch: 4 }]);
    expect(result.remaining).toEqual([after]);
  });
});

describe("clock.updated", () => {
  it("a tick (reason null) replaces the clock and receivedAt", () => {
    const { sim, effects } = applyMessage(synced(), tick("2025-12-06T11:00:00-08:00", 1043), WALL + 500);
    expect(sim.clock).toEqual({ ...CLOCK, current_time: "2025-12-06T11:00:00-08:00" });
    expect(sim.receivedAt).toBe(WALL + 500);
    expect(effects).toEqual([]);
  });

  it("doesn't roll back a clock from a newer epoch (a seek response)", () => {
    const s = { ...synced(), clock: { ...CLOCK, epoch: 4, current_time: "2026-02-11T13:00:00-08:00" } };
    const { sim } = applyMessage(s, tick("2025-12-06T10:01:00-08:00", 1043), WALL);
    expect(sim.clock?.current_time).toBe("2026-02-11T13:00:00-08:00");
    expect(sim.lastSeq).toBe(1043);
  });

  it("drops the reason and keeps the rest", () => {
    const changed = msg("clock.updated", { ...CLOCK, status: "RUNNING", speed: 300, reason: "RESUMED" }, 1043);
    const { sim, effects } = applyMessage(synced(), changed, WALL + 10);
    expect(sim.clock).toEqual({ ...CLOCK, status: "RUNNING", speed: 300 });
    expect(effects).toEqual([]);
  });

  it("an auto-pause emits auto-paused", () => {
    const changed = msg("clock.updated", { ...CLOCK, reason: "AUTO_PAUSE_PROPOSAL" }, 1043);
    expect(applyMessage(synced(), changed, WALL).effects).toEqual([{ kind: "auto-paused" }]);
  });
});

describe("entity upserts", () => {
  it("dispatch_event.updated replaces the whole event", () => {
    const updated = { ...EVENT, status: "DISPATCHED" as const };
    const { sim } = applyMessage(synced(), msg("dispatch_event.updated", updated, 1043), WALL);
    expect(sim.events[EVENT.id]).toEqual(updated);
  });

  it.each(["proposal.updated", "trip.updated"] as const)("%s replaces the trip", (type) => {
    const updated = { ...TRIP, status: "BUS_EN_ROUTE" as const };
    const { sim } = applyMessage(synced(), msg(type, updated, 1043), WALL);
    expect(sim.trips[TRIP.id]).toEqual(updated);
  });

  it("bus.updated replaces the bus", () => {
    const updated = { ...BUS, status: "DEADHEADING" as const, assigned_trip_id: TRIP.id, proposed_trip_id: null };
    const { sim } = applyMessage(synced(), msg("bus.updated", updated, 1043), WALL);
    expect(sim.buses[BUS.id]).toEqual(updated);
  });

  it("system.error keeps state and reports the message", () => {
    const { sim, effects } = applyMessage(synced(), msg("system.error", { message: "source query failed" }, 1043), WALL);
    expect(sim.lastSeq).toBe(1043);
    expect(effects).toEqual([{ kind: "system-error", message: "source query failed" }]);
  });
});

describe("effects", () => {
  const newEvent = { ...EVENT, id: "event-999" };

  it("a dispatch event seen for the first time emits event-new once", () => {
    const first = applyMessage(synced(), msg("dispatch_event.updated", newEvent, 1043), WALL);
    expect(first.effects).toEqual([{ kind: "event-new", event: newEvent }]);
    const again = applyMessage(first.sim, msg("dispatch_event.updated", { ...newEvent, status: "DISPATCHED" }, 1044), WALL);
    expect(again.effects).toEqual([]);
  });

  it("an event already in the snapshot is not new", () => {
    expect(applyMessage(synced(), msg("dispatch_event.updated", EVENT, 1043), WALL).effects).toEqual([]);
  });

  it("proposal.created emits trip-proposed for a new proposal", () => {
    const trip = { ...TRIP, id: "trip-789" };
    expect(applyMessage(synced(), msg("proposal.created", trip, 1043), WALL).effects).toEqual([{ kind: "trip-proposed", trip }]);
  });

  it("a trip entering EXPIRED emits trip-expired once", () => {
    const expired = { ...TRIP, status: "EXPIRED" as const };
    const first = applyMessage(synced(), msg("proposal.updated", expired, 1043), WALL);
    expect(first.effects).toEqual([{ kind: "trip-expired", trip: expired }]);
    expect(applyMessage(first.sim, msg("proposal.updated", expired, 1044), WALL).effects).toEqual([]);
  });
});
