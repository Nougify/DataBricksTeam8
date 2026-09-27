import { describe, expect, it } from "vitest";
import { EMPTY_HOUR_KEY, decideKeyUpdate, type SimHourKey } from "./timeKey";

const key = (hour: number, epoch = 3): SimHourKey => ({
  localDate: "2025-12-06",
  hour,
  epoch,
  at: `2025-12-06T${String(hour).padStart(2, "0")}:00:00-08:00`,
});
const running = (speed: number, visible = true, sinceLastChangeMs = 10_000) => ({
  paused: false,
  speed,
  visible,
  sinceLastChangeMs,
});

describe("decideKeyUpdate (spec §11.2 throttling)", () => {
  it("keeps the key within the same hour", () => {
    expect(decideKeyUpdate(key(10), { ...key(10), at: "2025-12-06T10:30:00-08:00" }, running(60))).toEqual({ kind: "keep" });
  });

  it("applies the first key immediately", () => {
    expect(decideKeyUpdate(EMPTY_HOUR_KEY, key(10), running(3600, false, 0))).toEqual({ kind: "apply" });
  });

  it("follows every hour below 900x", () => {
    expect(decideKeyUpdate(key(10), key(11), running(300, true, 100))).toEqual({ kind: "apply" });
  });

  it("at 900x and up, changes at most once every 2 s of wall time", () => {
    expect(decideKeyUpdate(key(10), key(11), running(900, true, 500))).toEqual({ kind: "wait", ms: 1500 });
    expect(decideKeyUpdate(key(10), key(11), running(900, true, 2000))).toEqual({ kind: "apply" });
  });

  it("at 3600x, only visible views follow", () => {
    expect(decideKeyUpdate(key(10), key(11), running(3600, false))).toEqual({ kind: "defer" });
    expect(decideKeyUpdate(key(10), key(11), running(3600, true))).toEqual({ kind: "apply" });
  });

  it("always catches up on pause", () => {
    const paused = { paused: true, speed: 3600, visible: false, sinceLastChangeMs: 0 };
    expect(decideKeyUpdate(key(10), key(14), paused)).toEqual({ kind: "apply" });
  });

  it("applies an epoch change (seek) immediately, even hidden at 3600x", () => {
    expect(decideKeyUpdate(key(10), key(10, 4), running(3600, false, 0))).toEqual({ kind: "apply" });
  });
});
