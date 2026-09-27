// Milestone 2b pure logic: the Now chart window, origin mix and surge destinations, arcs, the timeline scale,
// trip helpers, episode helpers and the bundled feed-day / driver-event lookups.
import { describe, expect, it } from "vitest";
import { driverEventsBetween } from "@/data/events";
import { feedDays, feedDaysActionableBy } from "@/data/feedDays";
import type { HubForecast } from "@/data/forecast";
import { originsFor } from "@/data/index";
import { arcCoordinates, arcWidth, bubbleRadius } from "@/features/map/arcs";
import { dayScale, monthStarts } from "@/features/timeline/scale";
import { EVENT, TRIP } from "@/lib/live/__tests__/fixtures";
import { buildEpisodes, episodeLeadMinutes, latestResolvedEpisode } from "@/lib/live/episodes";
import { activeTrips, approvalQueue, minutesLeft, tripEta, tripProgress } from "@/lib/live/trips";
import { vancouverToMs } from "@/lib/time";
import { buildForecastWindow, hourExists, surgeRuns } from "./now/forecastWindow";
import { buildOriginMix, surgeDestinations } from "./origins/originMix";

/** A synthetic 3-day snapshot starting 2026-03-07: value = slot index, typical 100, surge from slot 60. */
function fakeForecast(): HubForecast {
  const n = 72;
  const series = () => ({
    actual: Array.from({ length: n }, (_, i) => 200 + i),
    forecast: Array.from({ length: n }, (_, i) => 150 + i),
    typical: Array.from({ length: n }, () => 100),
    surge: Array.from({ length: n }, (_, i) => (i >= 60 && i < 63 ? 1 : 0) as 0 | 1),
  });
  return { hub_id: "ubc", start_date: "2026-03-07", days: 3, arrivals: series(), departures: series() };
}

describe("buildForecastWindow", () => {
  it("skips the spring-forward hour and never shows actuals from the current hour on", () => {
    const w = buildForecastWindow(fakeForecast(), "arrivals", "2026-03-08", 4, 3);
    expect(hourExists("2026-03-08", 2)).toBe(false);
    expect(w.rows.map((r) => r.key)).toEqual([
      "2026-03-08T00",
      "2026-03-08T01",
      "2026-03-08T03",
      "2026-03-08T04",
      "2026-03-08T05",
      "2026-03-08T06",
      "2026-03-08T07",
    ]);
    expect(w.nowIndex).toBe(3);
    expect(w.rows.filter((r) => r.actual !== null).map((r) => r.kind)).toEqual(["past", "past", "past"]);
    expect(w.rows[3].surge_line).toBe(125);
    expect(w.uncovered).toBe(false);
  });

  it("finds the future peak and the surge runs", () => {
    const w = buildForecastWindow(fakeForecast(), "arrivals", "2026-03-09", 10, 3);
    expect(w.peak?.key).toBe("2026-03-09T13");
    expect(surgeRuns(w.rows)).toEqual([["2026-03-09T12", "2026-03-09T13"]]);
  });

  it("flags a window outside the snapshot as uncovered", () => {
    expect(buildForecastWindow(fakeForecast(), "arrivals", "2025-11-20", 12, 6).uncovered).toBe(true);
  });
});

describe("buildOriginMix", () => {
  it("reproduces gold_origin_access shares for the whole dataset (UBC 47.6% transfer required)", () => {
    const seeds = originsFor("ubc");
    const pings = new Map(seeds.map((s) => [s.origin, s.pings]));
    const mix = buildOriginMix(seeds, (o) => pings.get(o) ?? 0);
    expect(mix.transferSharePct).toBeCloseTo(47.6, 0);
    const surrey = mix.regional.find((r) => r.origin === "Surrey")!;
    expect(surrey.share_of_local_pct).toBeCloseTo(14.5, 1);
    expect(mix.local?.share_of_local_pct).toBeNull();
    expect(mix.visitors.every((v) => v.location === null)).toBe(true);
    expect(mix.lowSample).toBe(false);
  });

  it("flags a low sample and handles an empty hour", () => {
    const mix = buildOriginMix(originsFor("ubc"), () => 0);
    expect(mix.lowSample).toBe(true);
    expect(mix.transferSharePct).toBe(0);
  });
});

describe("surgeDestinations", () => {
  it("matches feed names to dim_origin case- and space-insensitively, one row per destination", () => {
    const rec = EVENT.recommendations[0];
    const event = {
      ...EVENT,
      recommendations: [
        { ...rec, destination: "NewWestminster", priority_score: 5, destination_share: 6.3 },
        { ...rec, destination: "new westminster", priority_score: 4 },
        { ...rec, destination: "Atlantis", priority_score: 3 },
      ],
    };
    expect(surgeDestinations(event)).toMatchObject([
      { name: "New Westminster", matched: true, share: 6.3 },
      { name: "Atlantis", matched: false },
    ]);
    expect(surgeDestinations(null)).toEqual([]);
  });
});

describe("arcs", () => {
  it("run from origin to hub and bow to the left of travel", () => {
    const from = [-122.85, 49.19] as const; // Surrey
    const to = [-123.25, 49.26] as const; // UBC, to the west-north-west
    const c = arcCoordinates(from, to);
    expect(c).toHaveLength(48);
    expect(c[0][0]).toBeCloseTo(from[0]);
    expect(c[47][1]).toBeCloseTo(to[1]);
    // Travelling west, left is south: the midpoint sits below the chord.
    expect(c[24][1]).toBeLessThan((from[1] + to[1]) / 2);
  });

  it("scale width and radius", () => {
    expect(arcWidth(0)).toBe(1);
    expect(arcWidth(30)).toBe(10);
    expect(bubbleRadius(100, 100)).toBe(22);
    expect(bubbleRadius(0, 0)).toBe(3);
  });
});

describe("dayScale", () => {
  it("maps dates to x and back, clamped", () => {
    const s = dayScale("2025-11-15", "2026-08-31", 290);
    expect(s.days).toBe(290);
    expect(s.dateAt(s.x("2025-12-06"))).toBe("2025-12-06");
    expect(s.index("2025-11-01")).toBe(0);
    expect(s.shift("2026-08-30", 7)).toBe("2026-08-31");
    expect(monthStarts("2025-11-15", "2026-02-10")).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
  });
});

describe("trip helpers", () => {
  const t0 = Date.parse(TRIP.approval_expires_at);
  const a = { ...TRIP, id: "a", approval_expires_at: new Date(t0 + 60_000).toISOString() };
  const b = { ...TRIP, id: "b" };

  it("queue sorts by expiry and counts sim minutes down", () => {
    expect(approvalQueue([a, b, { ...TRIP, id: "c", status: "APPROVED" as const }]).map((t) => t.id)).toEqual(["b", "a"]);
    expect(minutesLeft(b, t0 - 90_000)).toBe(2);
    expect(minutesLeft(b, t0 + 1)).toBe(0);
  });

  it("derives progress and the next milestone", () => {
    const trip = {
      ...TRIP,
      status: "BUS_EN_ROUTE" as const,
      dispatch_time: "2025-12-06T12:00:00-08:00",
      estimated_arrival_time: "2025-12-06T12:20:00-08:00",
      service_departure_time: "2025-12-06T12:30:00-08:00",
      estimated_completion_time: "2025-12-06T13:00:00-08:00",
    };
    const at = Date.parse("2025-12-06T12:15:00-08:00");
    expect(tripProgress(trip, at)).toBeCloseTo(0.25);
    expect(tripEta(trip, at)).toEqual({ label: "Arrives", atMs: Date.parse(trip.estimated_arrival_time) });
    expect(activeTrips([trip, b]).map((t) => t.id)).toEqual([trip.id]);
  });
});

describe("episodes", () => {
  it("reports lead time and the latest resolved episode within a window", () => {
    const e = (id: string, time: string, actionable: string) => ({ ...EVENT, id, hub_id: "ubc", event_time: time, actionable_at: actionable });
    const eps = buildEpisodes([
      e("1", "2025-12-06T09:00:00-08:00", "2025-12-06T08:00:00-08:00"),
      e("2", "2025-12-06T09:30:00-08:00", "2025-12-06T08:30:00-08:00"),
    ]);
    expect(eps).toHaveLength(1);
    expect(episodeLeadMinutes(eps[0])).toBe(60);
    const after = Date.parse("2025-12-06T11:00:00-08:00");
    expect(latestResolvedEpisode(eps, "ubc", after, 24 * 3_600_000)?.id).toBe(eps[0].id);
    expect(latestResolvedEpisode(eps, "ubc", after + 25 * 3_600_000, 24 * 3_600_000)).toBeNull();
  });
});

describe("bundled lookups", () => {
  it("feed days only appear once actionable", () => {
    const ubcDec6 = feedDays.find((d) => d.hub_id === "ubc" && d.local_date === "2025-12-06")!;
    expect(ubcDec6.peak_index).toBe(1.99);
    const before = feedDaysActionableBy(ubcDec6.firstActionableMs - 1);
    expect(before.some((d) => d === ubcDec6)).toBe(false);
    expect(feedDaysActionableBy(ubcDec6.firstActionableMs)).toContain(ubcDec6);
    expect(feedDaysActionableBy(Number.NaN)).toEqual([]);
    expect(ubcDec6.firstActionableMs).toBe(vancouverToMs("2025-12-05", 23, 30));
  });

  it("driver events overlap by date and hub", () => {
    expect(driverEventsBetween("ubc", "2025-12-06", "2025-12-06").map((e) => e.id)).toEqual(["evt-ubc-exams-2025w1"]);
    expect(driverEventsBetween("waterfront", "2025-12-06", "2025-12-06")).toEqual([]);
    expect(driverEventsBetween("park-royal", "2025-12-26", "2025-12-26").map((e) => e.label)).toEqual(["Boxing Day"]);
  });
});
