import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Bus } from "@/lib/api/schemas";

// The MockSim singleton may not exist yet; stub it with a fixed clock (2025-12-06 13:20 PST, mid UBC surge).
const FIXED_NOW = Date.parse("2025-12-06T13:20:00-08:00");
const buses: Bus[] = [];
vi.mock("@/mocks/sim/instance", () => ({
  getMockSim: () => ({
    nowMs: () => FIXED_NOW,
    listBuses: () => buses,
    listTrips: () => [],
    listSurges: () => [],
  }),
}));
vi.mock("@/lib/api/mockGate", () => ({ mocksReady: () => Promise.resolve() }));

import * as api from "@/lib/api/endpoints";
import * as S from "@/lib/api/schemas";
import { useContractIssues } from "@/lib/api/contractIssues";
import { routeById } from "@/mocks/data";
import { readHandlers, routeRef } from "./read";

const server = setupServer(...readHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const HUBS = ["ubc", "waterfront", "park-royal"] as const;

afterEach(() => {
  // validateContract flags any response that fails its schema.
  expect(useContractIssues.getState().endpoints).toEqual([]);
});

describe("read handlers pass the contract schemas", () => {
  it("/meta", async () => {
    const meta = S.Meta.parse(await api.getMeta());
    expect(meta.default_start_time).toBe("2026-02-11T13:00:00-08:00");
    expect(meta.presets.find((p) => p.id === "normal-weekday")).toMatchObject({
      label: "Normal weekday 13:00",
      time: "2026-02-11T13:00:00-08:00",
      hub_id: null,
    });
  });

  it("/hubs", async () => {
    const hubs = S.HubList.parse(await api.getHubs());
    expect(hubs.map((h) => h.name)).toEqual(["UBC", "Waterfront Station", "Park Royal"]);
  });

  it.each(HUBS)("/hubs/%s/status (default at = sim clock)", async (hub) => {
    const s = S.HubStatus.parse(await api.getHubStatus(hub));
    expect(s.as_of).toBe("2025-12-06T13:20:00-08:00");
    expect(s.last_full_hour.hour).toBe(12);
  });

  it.each(HUBS)("/hubs/%s/forecast", async (hub) => {
    const f = S.Forecast.parse(await api.getForecast(hub, { horizon_hours: 6, history_hours: 6 }));
    expect(f.rows.map((r) => r.kind)).toEqual([...Array(6).fill("HISTORY"), "CURRENT", ...Array(6).fill("FORECAST")]);
    const current = f.rows[6];
    expect(current.hour).toBe(13);
    expect(current.hour_complete).toBe(false);
    // Never actuals after `at`.
    for (const r of f.rows.slice(7)) expect(r.actual_pings).toBeNull();
  });

  it("forecast: the UBC surge is visible from 10:00 on, not before", async () => {
    const at10 = await api.getForecast("ubc", { at: "2025-12-06T10:00:00-08:00", horizon_hours: 6, history_hours: 6 });
    const row13 = at10.rows.find((r) => r.hour === 13 && r.kind === "FORECAST")!;
    expect(row13.surge_index).toBeCloseTo(1.79, 1);
    expect(row13.is_surge).toBe(true);
    const at9 = await api.getForecast("ubc", { at: "2025-12-06T09:30:00-08:00", horizon_hours: 6, history_hours: 6 });
    expect(at9.rows.find((r) => r.hour === 13)!.is_surge).toBe(false);
  });

  it.each([
    ["2025-11-03T00:00:00-08:00", 25],
    ["2026-03-09T00:00:00-07:00", 23],
  ])("forecast: 24 history hours before %s cover %i distinct instants", async (at, n) => {
    const f = await api.getForecast("waterfront", { at, horizon_hours: 24, history_hours: n });
    const history = f.rows.filter((r) => r.kind === "HISTORY");
    expect(history).toHaveLength(n);
    // All of the previous calendar day, labelled by local hour: 25 or 23 buckets.
    expect(new Set(history.map((r) => r.local_date))).toEqual(new Set([history[0].local_date]));
  });

  it.each(HUBS)("/hubs/%s/origins (actual and typical)", async (hub) => {
    for (const basis of ["actual", "typical"] as const) {
      const o = S.Origins.parse(await api.getOrigins(hub, { basis }));
      expect(o.origins).toHaveLength(36);
      expect(o.window).toEqual({ start: "2025-12-06T12:00:00-08:00", end: "2025-12-06T13:00:00-08:00" });
      const regional = o.origins.filter((r) => r.share_of_local_pct !== null);
      const sum = regional.reduce((a, r) => a + (r.share_of_local_pct ?? 0), 0);
      expect(sum).toBeGreaterThan(99.5);
      expect(sum).toBeLessThan(100.5);
      for (const r of o.origins) {
        if (r.access_type === "LOCAL" || r.access_type === "VISITOR") expect(r.share_of_local_pct).toBeNull();
      }
    }
  });

  it("origins: the UBC surge crowd tilts toward the transfer-required suburbs", async () => {
    const at = "2025-12-06T14:05:00-08:00";
    const actual = await api.getOrigins("ubc", { at, basis: "actual" });
    const typical = await api.getOrigins("ubc", { at, basis: "typical" });
    const share = (o: S.Origins, name: string) => o.origins.find((r) => r.origin === name)!.share_of_local_pct!;
    expect(share(actual, "Surrey")).toBeGreaterThan(share(typical, "Surrey") * 1.3);
  });

  it.each(HUBS)("/hubs/%s/late-night", async (hub) => {
    const ln = S.LateNight.parse(await api.getLateNight(hub));
    expect(ln.night_date).toBe("2025-12-07");
    expect(ln.hours.map((h) => h.hour)).toEqual([0, 1, 2, 3, 4]);
    for (const h of ln.hours) expect(h.actual_pings).toBeNull();
    expect(ln.top_nights).toHaveLength(5);
  });

  it("late-night: during the night, only finished hours have actuals", async () => {
    const ln = await api.getLateNight("ubc", { at: "2026-02-15T02:30:00-08:00" });
    expect(ln.night_date).toBe("2026-02-15");
    expect(ln.hours.map((h) => h.actual_pings !== null)).toEqual([true, true, false, false, false]);
    expect(ln.hours[1].lines.length).toBeGreaterThan(0);
  });

  it("late-night: the spring-forward night skips 02:00", async () => {
    const ln = await api.getLateNight("waterfront", { at: "2026-03-07T22:00:00-08:00" });
    expect(ln.hours.map((h) => h.hour)).toEqual([0, 1, 3, 4]);
  });

  it.each(HUBS)("/hubs/%s/hourly-profile", async (hub) => {
    for (const dt of ["mf", "sat", "sun_hol"] as const) {
      const p = S.HourlyProfile.parse(await api.getHourlyProfile(hub, dt));
      expect(p.rows.map((r) => r.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    }
  });

  it.each(HUBS)("/hubs/%s/overview", async (hub) => {
    const o = S.Overview.parse(await api.getHubOverview(hub));
    expect(o.kpis.map((k) => k.key)).toEqual(["pings", "surge_days", "transfer_share", "worst_line", "peak_load"]);
  });

  it("overview: UBC values", async () => {
    const o = await api.getHubOverview("ubc");
    const byKey = Object.fromEntries(o.kpis.map((k) => [k.key, k]));
    expect(byKey.transfer_share.value).toBe(47.6);
    expect(byKey.surge_days.comparison).toEqual({ label: "Top", value: "Dec 6, 1.72x" });
    expect(byKey.peak_load.comparison?.value).toBe("99 WEST, 06-09 AM peak");
  });

  it.each(HUBS)("/hubs/%s/route-crowding", async (hub) => {
    const rows = S.RouteCrowding.parse(await api.getRouteCrowding(hub));
    expect(rows.length).toBeGreaterThan(0);
    const pct = rows.map((r) => r.pct_trips_overcrowded ?? -1);
    expect(pct).toEqual([...pct].sort((a, b) => b - a));
  });

  it.each(HUBS)("/hubs/%s/recommendations", async (hub) => {
    const recs = S.RecommendationList.parse(await api.getRecommendations(hub));
    expect(recs.length).toBeGreaterThan(0);
    recs.forEach((r, i) => {
      expect(r.id).toBe(`rec-${hub}-${i + 1}`);
      expect(r.links.length).toBeGreaterThan(0);
    });
  });

  it("recommendations: links by category", async () => {
    const recs = await api.getRecommendations("ubc");
    const link = (cat: string) => recs.find((r) => r.category === cat)!.links[0];
    expect(link("Add or retime midday service")).toMatchObject({ local_date: "2026-02-11", hour: 12, route_id: null });
    expect(link("Late-night service gap")).toMatchObject({ local_date: "2026-02-15", hour: 1 });
    expect(link("Close a transfer gap")).toMatchObject({ local_date: "2026-02-11", hour: 13 });
    expect(link("Plan for surge days")).toMatchObject({ local_date: "2025-12-06", hour: 9 });
    const line99 = recs.find((r) => r.evidence.startsWith("Line 99"))!.links[0];
    expect(line99).toMatchObject({ hour: 8, route_id: "6641" });
  });

  it("/findings", async () => {
    const f = S.Findings.parse(await api.getFindings());
    expect(f.hubs.map((h) => h.hub_id).sort()).toEqual(["park-royal", "ubc", "waterfront"]);
  });

  it("/backtest", async () => {
    const b = S.Backtest.parse(await api.getBacktest());
    expect(b.by_hub).toHaveLength(3);
  });

  it("/validation", async () => {
    const v = S.Validation.parse(await api.getValidation());
    expect(v.rows).toHaveLength(24);
    expect(v.r).toBeCloseTo(0.92, 2);
  });

  it("/timeline", async () => {
    const t = S.Timeline.parse(await api.getTimeline({ from: "2025-12-01", to: "2025-12-07" }));
    expect(t.days).toHaveLength(7);
    expect(Object.keys(t.days[5].hubs).sort()).toEqual(["park-royal", "ubc", "waterfront"]);
    expect(t.days[5].hubs.ubc.is_surge).toBe(true);
    const all = S.Timeline.parse(await api.getTimeline());
    expect(all.days).toHaveLength(304);
  });

  it("/events", async () => {
    const all = S.EventList.parse(await api.getEvents());
    expect(all).toHaveLength(12);
    expect(all.find((e) => e.id === "evt-bc-2025-12-26")?.label).toBe("Boxing Day");
    const dec = await api.getEvents({ from: "2025-12-05", to: "2025-12-06", hub_id: "ubc" });
    expect(dec.map((e) => e.id)).toEqual(["evt-ubc-exams-2025w1"]);
    const pr = await api.getEvents({ hub_id: "park-royal" });
    expect(pr.every((e) => e.category === "HOLIDAY")).toBe(true);
  });

  it("/routes", async () => {
    const plain = S.RouteList.parse(await api.getRoutes({ hub_id: "ubc" }));
    expect(plain.length).toBeGreaterThan(5);
    expect(plain.every((r) => r.shape === null && r.serves_hub_ids.includes("ubc"))).toBe(true);
    const shaped = S.RouteList.parse(await api.getRoutes({ hub_id: "ubc", include_shape: true }));
    expect(shaped.every((r) => r.shape !== null)).toBe(true);
  });

  it("/routes/:id", async () => {
    const d = S.RouteDetail.parse(await api.getRoute("6641"));
    expect(d.line_key).toBe("99");
    expect(d.stops.length).toBeGreaterThan(2);
    expect(d.scheduled_departures.length).toBeGreaterThan(0);
    expect(d.scheduled_departures[0].stop_id).not.toBeNull();
    await expect(api.getRoute("nope")).rejects.toMatchObject({ status: 404, code: "ROUTE_NOT_FOUND" });
  });

  it("/routes/load", async () => {
    const r25 = routeById("6627")!;
    buses.push({
      id: "bus-1",
      status: "AVAILABLE",
      location: { lat: 49.26, lon: -123.2 },
      heading_deg: 0,
      capacity: 77,
      source: { type: "ROUTE", route: routeRef(r25), depot_name: null },
      assigned_trip_id: null,
      proposed_trip_id: null,
    });
    const loads = S.RouteLoadList.parse(await api.getRouteLoad({ hub_id: "ubc", at: "2026-02-11T08:15:00-08:00" }));
    const l99 = loads.find((l) => l.route.line_key === "99")!;
    expect(l99.time_period).toBe("06-09 AM peak");
    expect(l99.classification).toBe("OVERCROWDED");
    expect(l99.pct_trips_overcrowded_2025).toBe(20.3);
    expect(loads.find((l) => l.route.line_key === "25")?.spare_buses_available).toBe(1);
    buses.length = 0;
  });

  it("unknown hub is a 404 in the contract error shape", async () => {
    await expect(api.getHubOverview("nowhere")).rejects.toMatchObject({ status: 404, code: "HUB_NOT_FOUND" });
  });
});
