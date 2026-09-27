"use client";

// A thin, client-only ECharts wrapper (DESIGN.md §9).
// - ECharts loads lazily (echartsSetup.ts: core + line/bar/custom, grid, tooltip, markLine, markArea; SVG).
// - Colours follow the theme: pass `option` as a function of the tokens and it is rebuilt when the theme
//   changes. Base text (font, 12 px, muted) and tooltip chrome are applied either way.
// - Animation is off at 900x and above, and under prefers-reduced-motion.
// - Resizes with its container (ResizeObserver) and disposes on unmount.
// - The container is role="img" with `ariaLabel` (the title plus the key numbers). Titles and legends are
//   HTML outside the chart, not ECharts components.
import { useEffect, useMemo, useRef, useState } from "react";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { useThemeTokens } from "@/lib/theme/tokens";
import { useSim } from "@/lib/live/store";
import { usePrefersReducedMotion } from "@/lib/useBreakpoint";
import { cn } from "@/lib/utils";
import { baseTooltip, type ThemeTokens } from "./ibcs";

/** Sim speeds at or above this turn chart animation off (spec §9.1). */
export const NO_ANIMATION_FROM_SPEED = 900;

export type EChartEventHandler = (params: unknown) => void;

export interface EChartProps {
  /**
   * The chart option, or a builder that receives the theme tokens (preferred, so colours follow the theme).
   * Memoise it (useMemo / useCallback): a new value re-applies the option.
   */
  option: EChartsCoreOption | ((tokens: ThemeTokens) => EChartsCoreOption);
  /** Required accessible summary: the chart's message plus its key numbers. */
  ariaLabel: string;
  /** CSS height of the chart area. Default 240. */
  height?: number | string;
  /** ECharts events by name, e.g. `{ click: (p) => … }`. Handlers may change between renders freely. */
  onEvents?: Readonly<Record<string, EChartEventHandler>>;
  className?: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function withDefaults(option: EChartsCoreOption, t: ThemeTokens, animate: boolean, fontFamily: string): EChartsCoreOption {
  const textStyle = isPlainObject(option.textStyle) ? option.textStyle : {};
  return {
    backgroundColor: "transparent",
    animationDuration: 300,
    animationDurationUpdate: 300,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    ...option,
    animation: animate && option.animation !== false,
    textStyle: { fontFamily, fontSize: 12, color: t["muted-foreground"], ...textStyle },
    ...(isPlainObject(option.tooltip) ? { tooltip: { ...baseTooltip(t), ...option.tooltip } } : {}),
  };
}

interface Ready {
  chart: EChartsType;
  fontFamily: string;
}

export function EChart({ option, ariaLabel, height = 240, onEvents, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const tokens = useThemeTokens();
  const reducedMotion = usePrefersReducedMotion();
  const fast = useSim((s) => (s.clock?.speed ?? 0) >= NO_ANIMATION_FROM_SPEED);
  const animate = !reducedMotion && !fast;

  // Create the instance once, after ECharts has loaded; dispose on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let disposed = false;
    let chart: EChartsType | null = null;
    let observer: ResizeObserver | null = null;
    let frame = 0;

    void import("./echartsSetup").then(({ echarts }) => {
      if (disposed) return;
      chart = echarts.init(el, null, { renderer: "svg" });
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (chart && !chart.isDisposed()) chart.resize();
        });
      });
      observer.observe(el);
      setReady({ chart, fontFamily: getComputedStyle(document.body).fontFamily });
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      chart?.dispose();
    };
  }, []);

  const resolved = useMemo(() => {
    if (!ready) return null;
    const base = typeof option === "function" ? option(tokens) : option;
    return withDefaults(base, tokens, animate, ready.fontFamily);
  }, [ready, option, tokens, animate]);

  useEffect(() => {
    if (!ready || !resolved || ready.chart.isDisposed()) return;
    // Merge so data changes transition; series are replaced so removed ones disappear.
    ready.chart.setOption(resolved, { replaceMerge: ["series"], lazyUpdate: true });
  }, [ready, resolved]);

  // Bind each event name once and dispatch to the latest handler, so inline handlers don't rebind every render.
  const handlers = useRef(onEvents);
  useEffect(() => {
    handlers.current = onEvents;
  });
  const eventNames = Object.keys(onEvents ?? {}).sort().join(",");
  useEffect(() => {
    if (!ready || !eventNames) return;
    const { chart } = ready;
    const bound = eventNames.split(",").map((name) => {
      const handler = (params: unknown) => handlers.current?.[name]?.(params);
      chart.on(name, handler);
      return [name, handler] as const;
    });
    return () => {
      if (chart.isDisposed()) return;
      for (const [name, handler] of bound) chart.off(name, handler);
    };
  }, [ready, eventNames]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      className={cn("w-full min-w-0", className)}
      style={{ height }}
    />
  );
}
