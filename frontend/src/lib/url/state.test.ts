import { describe, expect, it } from "vitest";
import { DEFAULT_HORIZON, DEFAULT_LAYERS } from "@/lib/live/store";
import { parseUrlState, serializeUrlState } from "./state";

const defaults = {
  selectedHubId: null,
  tab: "now" as const,
  originsBasis: "typical" as const,
  horizon: DEFAULT_HORIZON,
  layers: [...DEFAULT_LAYERS],
  pendingLinkTime: null,
};

describe("parseUrlState", () => {
  it("reads every param", () => {
    expect(parseUrlState("?hub=ubc&tab=dispatch&basis=all&h=12&layers=origins,routes&t=2025-12-06T13:00:00-08:00")).toEqual({
      hub: "ubc",
      tab: "dispatch",
      basis: "all",
      horizon: 12,
      layers: ["origins", "routes"],
      time: "2025-12-06T13:00:00-08:00",
    });
  });

  it("ignores invalid values", () => {
    expect(parseUrlState("?hub=UBC!&tab=map&basis=median&h=-3&layers=origins,bogus&t=tomorrow")).toEqual({
      hub: null,
      tab: null,
      basis: null,
      horizon: null,
      layers: ["origins"],
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
      tab: "origins",
      originsBasis: "all",
      horizon: 24,
      layers: ["routes", "origins"],
    });
    expect(new URLSearchParams(search).get("mock_nonhub")).toBe("1");
    expect(parseUrlState(search)).toMatchObject({
      hub: "ubc",
      tab: "origins",
      basis: "all",
      horizon: 24,
      layers: ["origins", "routes"],
    });
  });

  it("drops the tab when no hub is selected, and t once the banner is answered", () => {
    const search = serializeUrlState("?hub=ubc&tab=routes&t=2025-12-06T13:00:00-08:00", defaults);
    expect(search).toBe("");
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
