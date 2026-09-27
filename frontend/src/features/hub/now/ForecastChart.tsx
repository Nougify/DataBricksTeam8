"use client";

// The Now tab's forecast chart (spec §9.1, DESIGN.md §9, DECISIONS.md "Now chart"): actual (solid, to the last full
// hour), forecast (dashed), typical (thin grey), the surge line (typical × 1.25, dotted) and shaded forecast-surge
// hours, on a category axis keyed by local_date + hour, with a "Now" rule. No 80% band: the model publishes no
// interval. Visible dispatch events are overlaid as ring markers on the forecast line, never rescaled into it.
import { useCallback } from "react";
import { EChart } from "@/components/charts/EChart";
import {
  CHART_GRID,
  categoryAxis,
  nowMarker,
  seriesActual,
  seriesForecast,
  seriesTypical,
  surgeHoursArea,
  surgeLine,
  valueAxis,
  type ChartOption,
  type ThemeTokens,
} from "@/components/charts/ibcs";
import { SeverityMark } from "@/components/SeverityBadge";
import { LegendRow, LineSwatch } from "@/features/map/swatches";
import { severityForIndex, type Severity } from "@/config/scenario";
import type { DispatchEvent } from "@/lib/api/schemas";
import { fmtDateShort, fmtDuration, fmtIndex, fmtPings, fmtTime, hourLabel } from "@/lib/format";
import { hourKey, vancouverParts } from "@/lib/time";
import { surgeRuns, type ForecastWindow, type WindowRow } from "./forecastWindow";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEVERITY_TOKEN: Record<Severity, "surge-low" | "surge-medium" | "surge-high"> = {
  LOW: "surge-low",
  MEDIUM: "surge-medium",
  HIGH: "surge-high",
};

export interface EventMarker {
  key: string;
  events: DispatchEvent[];
  /** Highest surge_ratio in the hour. */
  index: number | null;
}

/** Visible dispatch events grouped by the Vancouver hour of their event_time, limited to the window's hours. */
export function eventMarkers(events: readonly DispatchEvent[], rows: readonly WindowRow[]): Map<string, EventMarker> {
  const keys = new Set(rows.map((r) => r.key));
  const out = new Map<string, EventMarker>();
  for (const e of events) {
    const p = vancouverParts(Date.parse(e.event_time));
    const key = hourKey(p.local_date, p.hour);
    if (!keys.has(key)) continue;
    const m = out.get(key) ?? { key, events: [], index: null };
    m.events.push(e);
    if (e.surge_ratio !== null && (m.index === null || e.surge_ratio > m.index)) m.index = e.surge_ratio;
    out.set(key, m);
  }
  for (const m of out.values()) m.events.sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time));
  return out;
}

const leadMin = (e: DispatchEvent) => Math.max(0, Math.round((Date.parse(e.event_time) - Date.parse(e.actionable_at)) / 60_000));

function tooltipHtml(row: WindowRow, marker: EventMarker | undefined, t: ThemeTokens): string {
  const line = (color: string, dash: string, label: string, value: string) =>
    `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span style="display:flex;gap:6px;align-items:center"><svg width="18" height="8"><line x1="1" x2="17" y1="4" y2="4" stroke="${color}" stroke-width="2" stroke-dasharray="${dash}"/></svg>${label}</span><b style="font-weight:600">${value}</b></div>`;
  const parts = [`<div style="margin-bottom:4px;font-weight:600">${fmtDateShort(row.local_date)}, ${hourLabel(row.hour)}–${hourLabel((row.hour + 1) % 24)}</div>`];
  if (row.kind === "past") parts.push(line(t.actual, "", "Actual", fmtPings(row.actual)));
  else parts.push(`<div style="color:${t["muted-foreground"]}">Actual: ${row.kind === "current" ? "hour in progress" : "not yet"}</div>`);
  parts.push(line(t.forecast, "4 3", "Forecast", fmtPings(row.forecast)));
  parts.push(line(t.typical, "", "Typical", fmtPings(row.typical)));
  parts.push(line(t["surge-high"], "1.5 2", "Surge line", fmtPings(row.surge_line)));
  if (row.forecast_index !== null) parts.push(`<div>Forecast ${fmtIndex(row.forecast_index)} typical${row.is_surge ? " (surge hour)" : ""}</div>`);
  for (const e of marker?.events ?? []) {
    parts.push(
      `<div style="margin-top:4px">Dispatch event ${fmtTime(e.event_time)}: ${fmtIndex(e.surge_ratio)}, known ${fmtDuration(leadMin(e))} ahead</div>`,
    );
  }
  parts.push(`<div style="margin-top:4px;color:${t["muted-foreground"]};font-size:12px">No 80% interval is published for this model.</div>`);
  return parts.join("");
}

export interface ForecastChartProps {
  window: ForecastWindow;
  markers: Map<string, EventMarker>;
  ariaLabel: string;
}

export function ForecastChart({ window: w, markers, ariaLabel }: ForecastChartProps) {
  const { rows, nowIndex } = w;
  const option = useCallback(
    (t: ThemeTokens): ChartOption => {
      const keys = rows.map((r) => r.key);
      const nowKey = rows[nowIndex]?.key;
      const markerData = rows.map((r) => {
        const m = markers.get(r.key);
        if (!m || r.forecast === null) return null;
        const sev = severityForIndex(m.index);
        const color = sev ? t[SEVERITY_TOKEN[sev]] : t.typical;
        return { value: r.forecast, itemStyle: { color: t.card, borderColor: color, borderWidth: 2.5 } };
      });
      return {
        // The legend names the surge line; a direct end label doesn't fit a 420 px panel.
        grid: { ...CHART_GRID, right: 16 },
        xAxis: categoryAxis(t, keys, {
          interval: rows.length > 30 ? 5 : 2,
          formatter: (_v, i) => {
            const r = rows[i];
            if (!r) return "";
            const prev = rows[i - 1];
            return prev && prev.local_date !== r.local_date ? `${WEEKDAY[new Date(`${r.local_date}T12:00:00Z`).getUTCDay()]} ${hourLabel(r.hour)}` : hourLabel(r.hour);
          },
        }),
        yAxis: valueAxis(t) as ChartOption["yAxis"],
        tooltip: {
          trigger: "axis",
          formatter: (params: unknown) => {
            const first = Array.isArray(params) ? (params[0] as { dataIndex?: number }) : null;
            const row = first?.dataIndex !== undefined ? rows[first.dataIndex] : undefined;
            return row ? tooltipHtml(row, markers.get(row.key), t) : "";
          },
        },
        series: [
          {
            ...seriesTypical(t, { data: rows.map((r) => r.typical) }),
            markArea: surgeHoursArea(t, surgeRuns(rows)),
          },
          { ...surgeLine(t, { data: rows.map((r) => r.surge_line) }), endLabel: { show: false } },
          seriesForecast(t, { data: rows.map((r) => r.forecast) }),
          {
            ...seriesActual(t, { data: rows.map((r) => r.actual) }),
            markLine: nowKey ? nowMarker(t, nowKey) : undefined,
          },
          {
            id: "dispatch-events",
            name: "Dispatch events",
            type: "line",
            data: markerData,
            lineStyle: { width: 0, opacity: 0 },
            symbol: "circle",
            symbolSize: 10,
            showSymbol: true,
            connectNulls: false,
            emphasis: { disabled: true },
            z: 6,
          },
        ],
      };
    },
    [rows, nowIndex, markers],
  );

  return <EChart option={option} ariaLabel={ariaLabel} height={232} />;
}

/** The chart's HTML legend, in the same notation as the lines (DESIGN.md §9). */
export function ForecastLegend({ hasMarkers }: { hasMarkers: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground">
      <LegendRow swatch={<LineSwatch strokeClass="stroke-actual" width={2.5} />}>Actual</LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-forecast" width={2} dash={[3, 2]} />}>Forecast (no 80% band published)</LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-typical" width={1.25} />}>Typical</LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-surge-high" width={1.5} dash={[1, 2]} />}>Surge line, 1.25× typical</LegendRow>
      <LegendRow swatch={<span className="block h-3 w-7 rounded-sm bg-surge-high/15" />}>Forecast surge hours</LegendRow>
      {hasMarkers && <LegendRow swatch={<SeverityMark severity="HIGH" variant="ring" className="mx-2" />}>Dispatch event</LegendRow>}
    </ul>
  );
}
