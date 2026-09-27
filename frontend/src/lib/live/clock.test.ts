import { afterEach, describe, expect, it, vi } from "vitest";
import { getSimNowMs, simNowMs } from "./clock";
import { applyMessage, applySnapshot, emptySim } from "./reducer";
import { useSim } from "./store";
import { CLOCK, makeState, msg } from "./__tests__/fixtures";

const T0 = Date.parse("2025-12-06T10:00:00-08:00");
const WALL = 5_000_000;
const MIN = 60_000;

describe("simNowMs", () => {
  it("is NaN before any clock arrives", () => {
    expect(simNowMs(null, 0, WALL)).toBeNaN();
  });

  it("stays at current_time while paused, however much wall time passes", () => {
    const paused = { ...CLOCK, status: "PAUSED" as const, speed: 300 as const };
    expect(simNowMs(paused, WALL, WALL)).toBe(T0);
    expect(simNowMs(paused, WALL, WALL + 10 * MIN)).toBe(T0);
  });

  it("extrapolates current_time + (wall − receivedAt) × speed while running", () => {
    const running = { ...CLOCK, status: "RUNNING" as const, speed: 60 as const };
    expect(simNowMs(running, WALL, WALL)).toBe(T0);
    // 1 real second at 60x = 1 sim minute.
    expect(simNowMs(running, WALL, WALL + 1000)).toBe(T0 + MIN);
    expect(simNowMs(running, WALL, WALL + 30_000)).toBe(T0 + 30 * MIN);
  });

  it("never runs backwards if the wall clock is behind receivedAt", () => {
    const running = { ...CLOCK, status: "RUNNING" as const };
    expect(simNowMs(running, WALL, WALL - 5000)).toBe(T0);
  });

  it("stops at max_time", () => {
    const nearEnd = {
      ...CLOCK,
      status: "RUNNING" as const,
      speed: 3600 as const,
      current_time: "2026-08-31T22:59:00-07:00",
    };
    expect(simNowMs(nearEnd, WALL, WALL + 60_000)).toBe(Date.parse(CLOCK.max_time));
  });

  it("re-bases on a speed change: time so far at the old speed, then the new one", () => {
    let s = applySnapshot(emptySim, makeState({ simulation: { ...CLOCK, status: "RUNNING", speed: 60 } }), WALL);
    // 10 s at 60x: 10 sim minutes.
    expect(simNowMs(s.clock, s.receivedAt, WALL + 10_000)).toBe(T0 + 10 * MIN);

    const changed = msg(
      "clock.updated",
      { ...CLOCK, status: "RUNNING", speed: 3600, current_time: "2025-12-06T10:10:00-08:00", reason: "SPEED" },
      1043,
    );
    s = applyMessage(s, changed, WALL + 10_000).sim;
    // Then 2 s at 3600x: 2 more sim hours.
    expect(simNowMs(s.clock, s.receivedAt, WALL + 12_000)).toBe(T0 + 10 * MIN + 2 * 60 * MIN);
  });

  it("snaps back to server time on each clock update", () => {
    let s = applySnapshot(emptySim, makeState({ simulation: { ...CLOCK, status: "RUNNING", speed: 60 } }), WALL);
    const tick = msg("clock.updated", {
      ...CLOCK,
      status: "RUNNING",
      current_time: "2025-12-06T10:00:30-08:00",
      reason: null,
    }, 1043);
    s = applyMessage(s, tick, WALL + 1000).sim;
    expect(simNowMs(s.clock, s.receivedAt, WALL + 1000)).toBe(T0 + 30_000);
  });
});

describe("getSimNowMs", () => {
  afterEach(() => {
    vi.useRealTimers();
    useSim.setState(useSim.getInitialState(), true);
  });

  it("reads the store and the wall clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(WALL);
    useSim.getState().setSnapshot(makeState({ simulation: { ...CLOCK, status: "RUNNING", speed: 300 } }));
    vi.setSystemTime(WALL + 2000);
    expect(getSimNowMs()).toBe(T0 + 10 * MIN);
  });
});
