import { describe, expect, it } from "vitest";
import { addDays, HOUR_MS, vancouverParts, vancouverToMs } from "@/lib/time";
import { dailyByHubDate } from "@/mocks/data";
import { synth } from "./synth";

describe("synth", () => {
  it("is deterministic and independent of call order", () => {
    const a = [synth.actualPings("ubc", "2026-02-11", 13), synth.forecastFor("waterfront", vancouverToMs("2026-02-11", 9), "2026-02-11", 15)];
    // Unrelated calls in between must not change anything.
    for (let h = 0; h < 24; h++) synth.actualPings("park-royal", "2026-03-01", h);
    const b = [synth.actualPings("ubc", "2026-02-11", 13), synth.forecastFor("waterfront", vancouverToMs("2026-02-11", 9), "2026-02-11", 15)];
    expect(b).toEqual(a);
  });

  it("uses daily.json day types, with holidays as sun_hol", () => {
    expect(synth.dayTypeFor("2026-02-11")).toBe("mf");
    expect(synth.dayTypeFor("2025-12-06")).toBe("sat");
    expect(synth.dayTypeFor("2025-12-26")).toBe("sun_hol");
    expect(synth.dayTypeFor("2026-10-10")).toBe("sat"); // outside the data: calendar fallback
  });

  it("hours roughly sum to the real daily total on a normal day", () => {
    const date = "2026-02-11";
    for (const hub of ["ubc", "waterfront", "park-royal"]) {
      let sum = 0;
      for (let h = 0; h < 24; h++) sum += synth.actualPings(hub, date, h);
      const daily = dailyByHubDate(hub, date)!.pings;
      expect(Math.abs(sum - daily) / daily).toBeLessThan(0.03);
    }
  });

  it("typical tracks the trailing same-day-type mean", () => {
    let typical = 0;
    for (let h = 0; h < 24; h++) typical += synth.typicalPings("ubc", "2026-02-11", h);
    const weekdays: number[] = [];
    for (let i = 1; i <= 56; i++) {
      const row = dailyByHubDate("ubc", addDays("2026-02-11", -i));
      if (row?.day_type === "mf") weekdays.push(row.pings);
    }
    const mean = weekdays.reduce((a, b) => a + b, 0) / weekdays.length;
    expect(Math.abs(typical - mean) / mean).toBeLessThan(0.01);
  });

  describe("scripted UBC exam surge (2025-12-06)", () => {
    const typical13 = synth.typicalPings("ubc", "2025-12-06", 13);
    const indexIssuedAt = (issuedHour: number) =>
      synth.forecastFor("ubc", vancouverToMs("2025-12-06", issuedHour), "2025-12-06", 13).forecast / typical13;

    it("forecasts issued before detection stay under the threshold", () => {
      for (const issued of [3, 6, 7, 9]) expect(indexIssuedAt(issued)).toBeLessThan(1.25);
    });

    it("forecasts issued at and after detection reach about 1.79", () => {
      expect(indexIssuedAt(10)).toBeCloseTo(1.79, 1);
      expect(indexIssuedAt(12)).toBeCloseTo(1.79, 1);
    });

    it("actual pings follow the scripted curve", () => {
      expect(synth.actualPings("ubc", "2025-12-06", 13) / typical13).toBeCloseTo(1.85, 1);
    });

    it("hub status at 14:20 reports the surge in the last full hour", () => {
      const s = synth.hubStatusAt("ubc", vancouverToMs("2025-12-06", 14, 20), {
        next_surge: null,
        active_trip_count: 0,
        pending_proposal_count: 0,
      });
      expect(s.last_full_hour.hour).toBe(13);
      expect(s.last_full_hour.is_surge).toBe(true);
      expect(s.current_hour.hour).toBe(14);
      expect(s.current_hour.pings_so_far).toBe(Math.round(synth.actualPings("ubc", "2025-12-06", 14) / 3));
      expect(s.as_of).toBe("2025-12-06T14:20:00-08:00");
    });
  });

  it("band widens with lead time", () => {
    const issued = vancouverToMs("2026-02-11", 8);
    const near = synth.forecastFor("ubc", issued, "2026-02-11", 9);
    const far = synth.forecastFor("ubc", issued, "2026-02-11", 20);
    expect((near.upper_80 - near.lower_80) / near.forecast).toBeCloseTo(2 * 0.09, 2);
    expect((far.upper_80 - far.lower_80) / far.forecast).toBeCloseTo(2 * 0.2, 2);
    expect(Number.isInteger(far.forecast)).toBe(true);
  });

  it.each([
    ["2025-11-02", 25],
    ["2026-03-08", 23],
    ["2026-02-11", 24],
  ])("DST: %s has %i hourly forecast buckets", (date, expected) => {
    const start = vancouverToMs(date, 0);
    const end = vancouverToMs(addDays(date, 1), 0);
    const keys: string[] = [];
    for (let ms = start; ms < end; ms += HOUR_MS) {
      const p = vancouverParts(ms);
      const f = synth.forecastFor("waterfront", start - 6 * HOUR_MS, p.local_date, p.hour);
      expect(f.forecast).toBeGreaterThan(0);
      keys.push(`${p.local_date}T${p.hour}`);
    }
    expect(keys).toHaveLength(expected);
  });

  it("the repeated 01:00 on 2025-11-02 returns the same value both times", () => {
    const first = vancouverToMs("2025-11-02", 1);
    const second = first + HOUR_MS;
    const p1 = vancouverParts(first);
    const p2 = vancouverParts(second);
    expect(p2.hour).toBe(1);
    expect(synth.actualPings("ubc", p1.local_date, p1.hour)).toBe(synth.actualPings("ubc", p2.local_date, p2.hour));
  });
});
