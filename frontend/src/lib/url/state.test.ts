import { describe, expect, it } from "vitest";
import { DEFAULT_HORIZON, DEFAULT_LAYERS } from "@/lib/live/store";
import { parseUrlState, serializeUrlState } from "./state";

const defaults = {
  selectedHubId: null,
  tab: "events" as const,
  originsBasis: "actual" as const,
  horizon: DEFAULT_HORIZON,
  layers: [...DEFAULT_LAYERS],
  pendingLinkTime: null,
};

describe("parseUrlState", () => {
  it("reads every param", () => {
    expect(parseUrlState("?hub=ubc&tab=proposals&basis=typical&h=12&layers=buses&t=2025-12-06T13:00:00-08:00")).toEqual({
      hub: "ubc",
      tab: "proposals",
      basis: "typical",
      horizon: 12,
      layers: ["buses"],
      time: "2025-12-06T13:00:00-08:00",
    });
  });

  it("ignores invalid values", () => {
    expect(parseUrlState("?hub=UBC!&tab=map&basis=median&h=-3&layers=routes,bogus&t=tomorrow")).toEqual({
      hub: null,
      tab: null,
      basis: null,
      horizon: null,
      layers: [],
      time: null,
    });
  });

  it("distinguishes absent layers (defaults) from an empty list (all off)", () => {
    expect(parseUrlState("").layers).toBeNull();
    expect(parseUrlState("?layers=").layers).toEqual([]);
  });

  it("normalises t to Vancouver time, repairing a decoded '+'", () => {
    expect(parseUrlState("?t=2025-12-06T21:00:00Z").time).toBe("2025-12-06T13:00:00-08:00");
    expect(parseUrlState("?t=2025-12-07T06:00:00+09:00").time).toBe("2025-12-06T13:00:00-08:00");
  });
});

describe("serializeUrlState", () => {
  it("omits defaults", () => {
    expect(serializeUrlState("", defaults)).toBe("");
  });

  it("writes non-defaults and keeps unrelated params", () => {
    const search = serializeUrlState("?mock_nonhub=1", {
      ...defaults,
      selectedHubId: "ubc",
      tab: "trips",
      originsBasis: "typical",
      horizon: 24,
      layers: ["buses"],
    });
    expect(new URLSearchParams(search).get("mock_nonhub")).toBe("1");
    expect(parseUrlState(search)).toMatchObject({
      hub: "ubc",
      tab: "trips",
      basis: "typical",
      horizon: 24,
      layers: ["buses"],
    });
  });

  it("drops default state and t once the banner is answered", () => {
    const search = serializeUrlState("?hub=ubc&tab=fleet&t=2025-12-06T13:00:00-08:00", defaults);
    expect(search).toBe("");
  });

  it("keeps a non-default operations tab without a hub", () => {
    expect(serializeUrlState("", { ...defaults, tab: "fleet" })).toBe("?tab=fleet");
  });

  it("keeps t while the banner is pending", () => {
    const search = serializeUrlState("?t=2025-12-06T13%3A00%3A00-08%3A00", {
      ...defaults,
      pendingLinkTime: "2025-12-06T13:00:00-08:00",
    });
    expect(parseUrlState(search).time).toBe("2025-12-06T13:00:00-08:00");
  });

  it("writes an empty layers list when everything is off", () => {
    expect(serializeUrlState("", { ...defaults, layers: [] })).toBe("?layers=");
  });
});
