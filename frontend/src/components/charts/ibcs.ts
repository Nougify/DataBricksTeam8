// IBCS scenario notation for ECharts, the same everywhere (spec §4.2 rule 5, DESIGN.md §9):
// actual = solid and darkest, forecast = dashed with a lighter 80% band, typical = thin grey,
// surge line = dotted surge-high, "now" = a thin ink rule. Every helper takes the theme tokens from
// useThemeTokens() (or the tokens EChart passes to an option builder), so colours follow the theme.
import type { ComposeOption } from "echarts/core";
import type { BarSeriesOption, CustomSeriesOption, LineSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { TokenName } from "@/lib/theme/tokens";
import { isDarkColor, parseHex } from "@/components/color";
import { fmtPings } from "@/lib/format";

export type ThemeTokens = Record<TokenName, string>;

/** Strictly typed option for the modules registered in echartsSetup.ts. */
export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | CustomSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | MarkLineComponentOption
  | MarkAreaComponentOption
>;

type AxisOption = Exclude<NonNullable<ChartOption["xAxis"]>, readonly unknown[]>;

/** One value per category (hour bucket); null leaves a gap. */
export type SeriesData = ReadonlyArray<number | null>;

/** Grid margins from DESIGN.md §9: the right margin leaves room for direct end labels. */
export const CHART_GRID = { left: 44, right: 64, top: 12, bottom: 28 } as const;

/** Dash patterns, shared by charts, legends and the map key. */
export const DASH = { forecast: [6, 4], surgeLine: [2, 3] } as const;

/** A token colour at the given opacity, as rgba(). Falls back to the input if it isn't hex. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

const isDark = (t: ThemeTokens) => isDarkColor(t.background);

interface SeriesArgs {
  data: SeriesData;
  /** Legend/tooltip name. */
  name?: string;
  /** Stable id, so updates animate instead of replacing the series. */
  id?: string;
}

/** Actual pings: 2.5 px solid `actual`, no symbols, on top. */
export function seriesActual(t: ThemeTokens, { data, name = "Actual", id = "actual" }: SeriesArgs): LineSeriesOption {
  return {
    id,
    name,
    type: "line",
    data: [...data],
    color: t.actual,
    lineStyle: { color: t.actual, width: 2.5, type: "solid" },
    symbol: "none",
    showSymbol: false,
    connectNulls: false,
    emphasis: { disabled: true },
    z: 5,
  };
}

/** Forecast pings: 2 px dashed `forecast` (HISTORY rows use the same style). */
export function seriesForecast(
  t: ThemeTokens,
  { data, name = "Forecast", id = "forecast" }: SeriesArgs,
): LineSeriesOption {
  return {
    id,
    name,
    type: "line",
    data: [...data],
    color: t.forecast,
    lineStyle: { color: t.forecast, width: 2, type: [...DASH.forecast] },
    symbol: "none",
    showSymbol: false,
    connectNulls: false,
    emphasis: { disabled: true },
    z: 4,
  };
}

/** Typical pings: 1.25 px solid `typical` (thin grey). */
export function seriesTypical(t: ThemeTokens, { data, name = "Typical", id = "typical" }: SeriesArgs): LineSeriesOption {
  return {
    id,
    name,
    type: "line",
    data: [...data],
    color: t.typical,
    lineStyle: { color: t.typical, width: 1.25, type: "solid" },
    symbol: "none",
    showSymbol: false,
    connectNulls: false,
    emphasis: { disabled: true },
    z: 2,
  };
}

/** A band data point: `value` is the stacked height (upper − lower); `lower`/`upper` are kept for tooltips. */
export interface BandDatum {
  value: number;
  lower: number;
  upper: number;
}

/**
 * The 80% interval as two stacked lines: an invisible lower line and an area of height (upper − lower) in
 * `forecast` at 14% (light) / 22% (dark), with no stroke. In a tooltip formatter, read the band's bounds
 * from `params.data.lower` / `params.data.upper` on the upper series, not from its value.
 */
export function bandSeries(
  t: ThemeTokens,
  {
    lower,
    upper,
    name = "80% range",
    id = "band-80",
  }: { lower: SeriesData; upper: SeriesData; name?: string; id?: string },
): [LineSeriesOption, LineSeriesOption] {
  const stack = id;
  const base = {
    type: "line" as const,
    stack,
    symbol: "none",
    showSymbol: false,
    connectNulls: false,
    silent: true,
    emphasis: { disabled: true },
    lineStyle: { opacity: 0, width: 0 },
    z: 1,
  };
  const bandData = lower.map((lo, i) => {
    const hi = upper[i];
    if (lo == null || hi == null) return null;
    const datum: BandDatum = { value: Math.max(0, hi - lo), lower: lo, upper: hi };
    return datum;
  });
  return [
    { ...base, id: `${id}-lower`, name: `${name} (lower bound)`, data: lower.map((lo, i) => (upper[i] == null ? null : lo)) },
    {
      ...base,
      id: `${id}-upper`,
      name,
      color: t.forecast,
      data: bandData,
      areaStyle: { color: withAlpha(t.forecast, isDark(t) ? 0.22 : 0.14), opacity: 1 },
    },
  ];
}

/**
 * The surge line (typical × threshold): a series, not a constant, because typical changes by hour.
 * 1.5 px dotted `surge-high`, direct end label in 12 px muted text.
 */
export function surgeLine(
  t: ThemeTokens,
  {
    data,
    name = "Surge line",
    id = "surge-line",
    label = "Surge line, 1.25× typical",
  }: SeriesArgs & { label?: string },
): LineSeriesOption {
  return {
    id,
    name,
    type: "line",
    data: [...data],
    color: t["surge-high"],
    lineStyle: { color: t["surge-high"], width: 1.5, type: [...DASH.surgeLine] },
    symbol: "none",
    showSymbol: false,
    connectNulls: false,
    emphasis: { disabled: true },
    endLabel: { show: true, formatter: label, color: t["muted-foreground"], fontSize: 12 },
    z: 3,
  };
}

/**
 * The vertical "now" rule, as a markLine to attach to any series on the category axis:
 * `{ ...seriesActual(t, ...), markLine: nowMarker(t, "2025-12-06T13") }`.
 */
export function nowMarker(t: ThemeTokens, x: string | number, label = "Now"): MarkLineComponentOption {
  return {
    silent: true,
    symbol: ["none", "none"],
    animation: false,
    lineStyle: { color: t.foreground, width: 1, type: "solid" },
    label: { show: true, formatter: label, position: "end", color: t.foreground, fontSize: 12 },
    data: [{ xAxis: x }],
  };
}

/** The 1.0 baseline every index axis draws (spec §4.2 rule 4): 1 px `muted-foreground`, labelled. */
export function baselineIndex(t: ThemeTokens, value = 1, label = "Typical (1.00×)"): MarkLineComponentOption {
  return {
    silent: true,
    symbol: ["none", "none"],
    animation: false,
    lineStyle: { color: t["muted-foreground"], width: 1, type: "solid" },
    label: { show: true, formatter: label, position: "insideEndTop", color: t["muted-foreground"], fontSize: 12 },
    data: [{ yAxis: value }],
  };
}

/** Shaded background for surge hours (`is_surge`): `surge-high` at 8% (light) / 12% (dark), no border. */
export function surgeHoursArea(t: ThemeTokens, ranges: ReadonlyArray<readonly [string, string]>): MarkAreaComponentOption {
  return {
    silent: true,
    itemStyle: { color: withAlpha(t["surge-high"], isDark(t) ? 0.12 : 0.08), borderWidth: 0 },
    data: ranges.map(([from, to]) => [{ xAxis: from }, { xAxis: to }]),
  };
}

/** Tooltip chrome from DESIGN.md §9: axis trigger, thin crosshair, card background, border, radius 8, 14 px. */
export function baseTooltip(t: ThemeTokens): TooltipComponentOption {
  return {
    trigger: "axis",
    axisPointer: { type: "line", lineStyle: { color: t["muted-foreground"], width: 1, type: "solid" } },
    backgroundColor: t.card,
    borderColor: t.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: t.foreground, fontSize: 14 },
    extraCssText: "border-radius: 8px; box-shadow: var(--elevation-float);",
  };
}

/**
 * Category x axis keyed by local_date + hour (never epoch maths): 1 px `border` axis line, no ticks,
 * 12 px muted labels. Pass a `formatter` for "09:00" / "Sun 00:00" labels and `interval` for every 3 h.
 */
export function categoryAxis(
  t: ThemeTokens,
  data: readonly string[],
  opts: { formatter?: (value: string, index: number) => string; interval?: number } = {},
): AxisOption {
  return {
    type: "category",
    data: [...data],
    boundaryGap: false,
    axisLine: { show: true, lineStyle: { color: t.border, width: 1 } },
    axisTick: { show: false },
    axisLabel: {
      color: t["muted-foreground"],
      fontSize: 12,
      interval: opts.interval ?? "auto",
      ...(opts.formatter ? { formatter: opts.formatter } : {}),
    },
  };
}

/** Value y axis: starts at 0, no axis line, 4 split lines in `border`, thousands separators. */
export function valueAxis(t: ThemeTokens, opts: { formatter?: (value: number) => string; min?: number } = {}): AxisOption {
  return {
    type: "value",
    min: opts.min ?? 0,
    splitNumber: 4,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: t.border, width: 1 } },
    axisLabel: {
      color: t["muted-foreground"],
      fontSize: 12,
      formatter: opts.formatter ?? ((v: number) => fmtPings(v)),
    },
  };
}
