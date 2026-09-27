import { describe, expect, it } from "vitest";
import type { TokenName } from "@/lib/theme/tokens";
import { bandSeries, nowMarker, seriesActual, seriesForecast, seriesTypical, surgeLine, withAlpha, type BandDatum } from "./ibcs";

const light = {
  actual: "#0b2b33",
  forecast: "#195fb3",
  typical: "#656e71",
  "surge-high": "#9d4203",
  foreground: "#0b2b33",
  "muted-foreground": "#4f666d",
  background: "#ecf3f2",
  border: "#cdd8d9",
  card: "#fafdfd",
} as Record<TokenName, string>;
const dark = { ...light, background: "#0a171b", forecast: "#659fe4" };

describe("IBCS series helpers", () => {
  it("draws actual solid, forecast dashed and typical thin", () => {
    const a = seriesActual(light, { data: [1, 2, null] });
    const f = seriesForecast(light, { data: [1, 2, 3] });
    const t = seriesTypical(light, { data: [1, 1, 1] });
    expect(a.lineStyle).toMatchObject({ type: "solid", width: 2.5, color: light.actual });
    expect(f.lineStyle).toMatchObject({ type: [6, 4], width: 2, color: light.forecast });
    expect(t.lineStyle).toMatchObject({ type: "solid", width: 1.25, color: light.typical });
    expect(a.data).toEqual([1, 2, null]);
  });

  it("stacks the 80% band and keeps its bounds for tooltips", () => {
    const [lower, upper] = bandSeries(light, { lower: [80, null, 90], upper: [120, 130, null] });
    expect(lower.stack).toBe(upper.stack);
    expect(lower.data).toEqual([80, null, null]);
    const first = (upper.data as (BandDatum | null)[])[0];
    expect(first).toEqual({ value: 40, lower: 80, upper: 120 });
    expect((upper.data as (BandDatum | null)[])[1]).toBeNull();
    expect(upper.areaStyle?.color).toBe(withAlpha(light.forecast, 0.14));
    const [, darkUpper] = bandSeries(dark, { lower: [1], upper: [2] });
    expect(darkUpper.areaStyle?.color).toBe(withAlpha(dark.forecast, 0.22));
  });

  it("draws the surge line dotted with a direct label, and a now rule", () => {
    const s = surgeLine(light, { data: [1.25] });
    expect(s.lineStyle).toMatchObject({ type: [2, 3], color: light["surge-high"] });
    expect(s.endLabel).toMatchObject({ show: true, formatter: "Surge line, 1.25× typical" });
    expect(nowMarker(light, "2025-12-06T13").data).toEqual([{ xAxis: "2025-12-06T13" }]);
  });

  it("converts hex to rgba", () => {
    expect(withAlpha("#195fb3", 0.14)).toBe("rgba(25, 95, 179, 0.14)");
  });
});
