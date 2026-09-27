import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  addDays,
  dayTypeOf,
  hourKey,
  startOfVancouverHour,
  toVancouverIso,
  vancouverParts,
  vancouverToMs,
} from "./index";

const ms = (iso: string) => Date.parse(iso);

describe("vancouverToMs", () => {
  it("converts ordinary wall-clock times with the right offset", () => {
    expect(vancouverToMs("2025-12-06", 13)).toBe(ms("2025-12-06T13:00:00-08:00"));
    expect(vancouverToMs("2026-07-25", 10, 30)).toBe(ms("2026-07-25T10:30:00-07:00"));
    expect(vancouverToMs("2025-12-06", 0)).toBe(ms("2025-12-06T00:00:00-08:00"));
    expect(vancouverToMs("2025-12-06", 23, 59)).toBe(ms("2025-12-06T23:59:00-08:00"));
  });

  it("2025-11-02 (fall back): the repeated 01:00 resolves to its first, PDT occurrence", () => {
    expect(vancouverToMs("2025-11-02", 0)).toBe(ms("2025-11-02T00:00:00-07:00"));
    expect(vancouverToMs("2025-11-02", 1)).toBe(ms("2025-11-02T01:00:00-07:00"));
    expect(vancouverToMs("2025-11-02", 1, 30)).toBe(ms("2025-11-02T01:30:00-07:00"));
    expect(vancouverToMs("2025-11-02", 2)).toBe(ms("2025-11-02T02:00:00-08:00"));
    // Midnight to midnight is 25 hours.
    expect(vancouverToMs("2025-11-03", 0) - vancouverToMs("2025-11-02", 0)).toBe(25 * HOUR_MS);
  });

  it("2026-03-08 (spring forward): the missing 02:00 moves forward to 03:00 PDT", () => {
    expect(vancouverToMs("2026-03-08", 1)).toBe(ms("2026-03-08T01:00:00-08:00"));
    expect(vancouverToMs("2026-03-08", 2)).toBe(ms("2026-03-08T03:00:00-07:00"));
    expect(vancouverToMs("2026-03-08", 3)).toBe(ms("2026-03-08T03:00:00-07:00"));
    // Midnight to midnight is 23 hours.
    expect(vancouverToMs("2026-03-09", 0) - vancouverToMs("2026-03-08", 0)).toBe(23 * HOUR_MS);
  });
});

describe("toVancouverIso", () => {
  it("formats with the offset in force at that instant", () => {
    expect(toVancouverIso(ms("2025-12-06T21:00:00Z"))).toBe("2025-12-06T13:00:00-08:00");
    expect(toVancouverIso(ms("2026-07-25T17:00:00Z"))).toBe("2026-07-25T10:00:00-07:00");
  });

  it("round-trips the contract's ISO strings", () => {
    for (const iso of ["2025-12-06T10:00:00-08:00", "2026-08-31T23:00:00-07:00", "2025-11-15T00:00:00-08:00"]) {
      expect(toVancouverIso(ms(iso))).toBe(iso);
    }
  });

  it("labels both 01:30s on 2025-11-02 distinctly", () => {
    expect(toVancouverIso(ms("2025-11-02T08:30:00Z"))).toBe("2025-11-02T01:30:00-07:00");
    expect(toVancouverIso(ms("2025-11-02T09:30:00Z"))).toBe("2025-11-02T01:30:00-08:00");
  });

  it("jumps from 01:59 PST to 03:00 PDT on 2026-03-08", () => {
    expect(toVancouverIso(ms("2026-03-08T09:59:00Z"))).toBe("2026-03-08T01:59:00-08:00");
    expect(toVancouverIso(ms("2026-03-08T10:00:00Z"))).toBe("2026-03-08T03:00:00-07:00");
  });

  it("gives midnight as hour 0, never 24", () => {
    expect(vancouverParts(ms("2025-12-07T00:00:00-08:00")).hour).toBe(0);
    expect(toVancouverIso(ms("2025-12-07T08:00:00Z"))).toBe("2025-12-07T00:00:00-08:00");
  });
});

describe("startOfVancouverHour", () => {
  it("truncates to the hour", () => {
    expect(startOfVancouverHour(ms("2025-12-06T13:47:12.345-08:00"))).toBe(ms("2025-12-06T13:00:00-08:00"));
  });

  it("keeps the two 01:00 hours on 2025-11-02 apart", () => {
    expect(startOfVancouverHour(ms("2025-11-02T01:30:00-07:00"))).toBe(ms("2025-11-02T01:00:00-07:00"));
    expect(startOfVancouverHour(ms("2025-11-02T01:30:00-08:00"))).toBe(ms("2025-11-02T01:00:00-08:00"));
  });

  it("goes straight from 01:00 PST to 03:00 PDT on 2026-03-08", () => {
    expect(startOfVancouverHour(ms("2026-03-08T01:59:59-08:00"))).toBe(ms("2026-03-08T01:00:00-08:00"));
    expect(startOfVancouverHour(ms("2026-03-08T03:15:00-07:00"))).toBe(ms("2026-03-08T03:00:00-07:00"));
  });
});

describe("dayTypeOf", () => {
  it("classifies weekdays, Saturdays, Sundays and BC holidays", () => {
    expect(dayTypeOf("2025-12-06")).toBe("sat");
    expect(dayTypeOf("2025-12-07")).toBe("sun_hol");
    expect(dayTypeOf("2026-02-11")).toBe("mf");
    expect(dayTypeOf("2025-12-26")).toBe("sun_hol"); // Boxing Day, a Friday
    expect(dayTypeOf("2026-02-16")).toBe("sun_hol"); // Family Day, a Monday
    expect(dayTypeOf("2026-07-25")).toBe("sat");
  });

  it("classifies both DST days (Sundays)", () => {
    expect(dayTypeOf("2025-11-02")).toBe("sun_hol");
    expect(dayTypeOf("2026-03-08")).toBe("sun_hol");
    expect(dayTypeOf("2025-11-03")).toBe("mf");
    expect(dayTypeOf("2026-03-07")).toBe("sat");
  });

  it("accepts a custom holiday set", () => {
    expect(dayTypeOf("2026-02-11", new Set(["2026-02-11"]))).toBe("sun_hol");
    expect(dayTypeOf("2026-02-16", new Set())).toBe("mf");
  });
});

describe("addDays", () => {
  it("steps calendar days across DST changes, months and years", () => {
    expect(addDays("2025-11-01", 1)).toBe("2025-11-02");
    expect(addDays("2025-11-02", 1)).toBe("2025-11-03");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-11-15", 7)).toBe("2025-11-22");
    expect(addDays("2026-08-31", 0)).toBe("2026-08-31");
  });
});

describe("hourKey", () => {
  it("pads the hour", () => {
    expect(hourKey("2025-12-06", 9)).toBe("2025-12-06T09");
    expect(hourKey("2025-12-06", 13)).toBe("2025-12-06T13");
  });
});
