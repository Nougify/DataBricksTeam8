// Output must be America/Vancouver whatever the machine's zone. Besides the loop over process.env.TZ
// below, run this file with TZ=UTC and TZ=Asia/Tokyo.
import { afterAll, describe, expect, it } from "vitest";
import { HOUR_MS, vancouverToMs } from "@/lib/time";
import {
  compact,
  fmtClock,
  fmtDate,
  fmtDateShort,
  fmtDuration,
  fmtIndex,
  fmtPct,
  fmtPings,
  fmtPingsKpi,
  fmtTime,
  fmtWindow,
  hourLabel,
  signed,
  tzAbbr,
} from "./index";

/** "HH:MM TZ" for every wall-clock hour of a Vancouver calendar day, stepping in real hours. */
function hoursOfDay(localDate: string): string[] {
  const out: string[] = [];
  for (let ms = vancouverToMs(localDate, 0); fmtDate(ms) === fmtDate(vancouverToMs(localDate, 12)); ms += HOUR_MS) {
    out.push(`${fmtTime(ms)} ${tzAbbr(ms)}`);
  }
  return out;
}

const pad = (h: number) => String(h).padStart(2, "0");

function dstAssertions() {
  // 2025-11-02: 25 hours; 01:00 happens twice, PDT then PST.
  const fallBack = hoursOfDay("2025-11-02");
  expect(fallBack).toHaveLength(25);
  expect(fallBack.slice(0, 4)).toEqual(["00:00 PDT", "01:00 PDT", "01:00 PST", "02:00 PST"]);
  expect(fallBack.at(-1)).toBe("23:00 PST");
  expect(fmtDate(vancouverToMs("2025-11-02", 12))).toBe("Sun Nov 2 2025");

  // API instants either side of the change.
  expect([fmtTime("2025-11-02T01:30:00-07:00"), tzAbbr("2025-11-02T01:30:00-07:00")]).toEqual(["01:30", "PDT"]);
  expect([fmtTime("2025-11-02T01:30:00-08:00"), tzAbbr("2025-11-02T01:30:00-08:00")]).toEqual(["01:30", "PST"]);
  expect(fmtTime("2025-11-02T08:59:00Z")).toBe("01:59");
  expect(fmtTime("2025-11-02T09:00:00Z")).toBe("01:00");

  // 2026-03-08: 23 hours; 02:00 doesn't exist.
  const springForward = hoursOfDay("2026-03-08");
  expect(springForward).toHaveLength(23);
  expect(springForward.slice(0, 3)).toEqual(["00:00 PST", "01:00 PST", "03:00 PDT"]);
  expect(springForward.some((h) => h.startsWith("02:"))).toBe(false);
  expect(springForward.at(-1)).toBe("23:00 PDT");
  expect(fmtDate(vancouverToMs("2026-03-08", 12))).toBe("Sun Mar 8 2026");
  expect(fmtTime("2026-03-08T09:59:00Z")).toBe("01:59");
  expect(fmtTime("2026-03-08T10:00:00Z")).toBe("03:00");
  expect(fmtWindow("2026-03-08T01:00:00-08:00", "2026-03-08T03:00:00-07:00")).toBe("01:00–03:00");

  // The day before and after each change are ordinary 24-hour days.
  for (const day of ["2025-11-01", "2025-11-03", "2026-03-07", "2026-03-09"]) {
    expect(hoursOfDay(day).map((h) => h.slice(0, 5))).toEqual(Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`));
  }

  expect(fmtClock("2025-12-06T13:20:00-08:00")).toEqual({ weekday: "Sat", date: "Dec 6 2025", time: "13:20", tz: "PST" });
  expect(fmtClock("2026-07-25T14:05:00-07:00")).toEqual({ weekday: "Sat", date: "Jul 25 2026", time: "14:05", tz: "PDT" });
  // Late evening in Vancouver is already the next day in UTC and Tokyo.
  expect(fmtDate("2025-12-06T23:30:00-08:00")).toBe("Sat Dec 6 2025");
  expect(fmtTime("2025-12-07T07:30:00Z")).toBe("23:30");
}

describe("America/Vancouver on the DST days", () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("under the machine's own zone", dstAssertions);

  it.each(["UTC", "Asia/Tokyo", "America/New_York", "Europe/London", "America/Vancouver"])(
    "with the machine zone set to %s",
    (tz) => {
      process.env.TZ = tz;
      expect(new Date(Date.UTC(2025, 6, 1)).getTimezoneOffset()).toBe(
        tz === "UTC" ? 0 : tz === "Asia/Tokyo" ? -540 : tz === "America/New_York" ? 240 : tz === "Europe/London" ? -60 : 420,
      );
      dstAssertions();
    },
  );
});

describe("number formats", () => {
  it("pings use thousands separators and whole numbers", () => {
    expect(fmtPings(3920)).toBe("3,920");
    expect(fmtPings(10324110)).toBe("10,324,110");
    expect(fmtPings(2819.5)).toBe("2,820");
    expect(fmtPings(0)).toBe("0");
    expect(fmtPings(null)).toBe("—");
    expect(fmtPings(Number.NaN)).toBe("—");
  });

  it("KPI pings go compact only above 100k", () => {
    expect(fmtPingsKpi(10324110)).toBe("10.3M");
    expect(fmtPingsKpi(150_000)).toBe("150K");
    expect(fmtPingsKpi(100_000)).toBe("100,000");
    expect(fmtPingsKpi(61234)).toBe("61,234");
    expect(fmtPingsKpi(undefined)).toBe("—");
  });

  it("index has two decimals and a multiplication sign", () => {
    expect(fmtIndex(1.79)).toBe("1.79×");
    expect(fmtIndex(1.5)).toBe("1.50×");
    expect(fmtIndex(1)).toBe("1.00×");
    expect(fmtIndex(null)).toBe("—");
  });

  it("percent has one decimal", () => {
    expect(fmtPct(14.5)).toBe("14.5%");
    expect(fmtPct(47.6)).toBe("47.6%");
    expect(fmtPct(104)).toBe("104.0%");
    expect(fmtPct(null)).toBe("—");
  });

  it("compact, signed and hourLabel match the hub_pulse helpers", () => {
    expect(compact(10324110)).toBe("10.3M");
    expect(signed(5)).toBe("+5");
    expect(signed(-3)).toBe("-3");
    expect(signed(0)).toBe("0");
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(13)).toBe("13:00");
  });

  it("durations read as hours and minutes", () => {
    expect(fmtDuration(160)).toBe("2 h 40 min");
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtDuration(180)).toBe("3 h");
    expect(fmtDuration(0)).toBe("0 min");
    expect(fmtDuration(44.6)).toBe("45 min");
    expect(fmtDuration(-90)).toBe("-1 h 30 min");
    expect(fmtDuration(null)).toBe("—");
  });
});

describe("time and date formats", () => {
  it("time is 24-hour Vancouver wall clock", () => {
    expect(fmtTime("2025-12-06T13:00:00-08:00")).toBe("13:00");
    expect(fmtTime("2025-12-06T21:00:00Z")).toBe("13:00");
    expect(fmtTime("2025-12-07T00:30:00-08:00")).toBe("00:30");
    expect(fmtTime(Date.parse("2026-07-25T10:00:00-07:00"))).toBe("10:00");
  });

  it("dates read like 'Sat Dec 6 2025'", () => {
    expect(fmtDate("2025-12-06T13:00:00-08:00")).toBe("Sat Dec 6 2025");
    expect(fmtDate("2026-02-11T13:00:00-08:00")).toBe("Wed Feb 11 2026");
  });

  it("short dates come straight from local_date", () => {
    expect(fmtDateShort("2025-12-06")).toBe("Sat Dec 6");
    expect(fmtDateShort("2026-03-08")).toBe("Sun Mar 8");
    expect(fmtDateShort("2025-11-02")).toBe("Sun Nov 2");
    expect(fmtDateShort("not a date")).toBe("—");
  });

  it("tz abbreviation follows the offset at that instant", () => {
    expect(tzAbbr("2025-12-06T13:00:00-08:00")).toBe("PST");
    expect(tzAbbr("2026-07-25T10:00:00-07:00")).toBe("PDT");
  });

  it("windows use an en dash", () => {
    expect(fmtWindow("2025-12-06T13:00:00-08:00", "2025-12-06T15:00:00-08:00")).toBe("13:00–15:00");
  });

  it("invalid instants render as a dash instead of throwing", () => {
    expect(fmtTime("nope")).toBe("—");
    expect(fmtDate(Number.NaN)).toBe("—");
    expect(tzAbbr(null)).toBe("—");
    expect(fmtClock(undefined)).toEqual({ weekday: "—", date: "—", time: "—", tz: "—" });
  });
});
