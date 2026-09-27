"use client";

// Timeline scrubber (spec §17.1, DESIGN.md §9 "Timeline", DECISIONS.md "Later answers" and "2b answers").
//   - Full (desktop, phone sheet): three lanes, one per hub, each a thin line of daily pings on its own scale
//     (daily.json); the selected hub's lane is emphasised. ▲ = retrospective surge day, coloured by its index band.
//   - Compact (tablet, 56 px): markers only, in one lane.
//   - ○ = a day whose dispatch events had become actionable by the sim time (feed_days.json); never future ones.
//   - A 4 px strip above the lanes: exam periods (solid) and BC holidays (hatched).
//   - The handle sits on the sim date. Dragging previews the date; releasing seeks once, 300 ms later, to that date
//     at the current sim hour. Clicking a marker seeks to 09:00 that day. Keyboard: ←/→ a day, Shift a week,
//     Enter seeks, Esc cancels.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { HUBS, hubName } from "@/config/hubs";
import { severityForIndex, type Severity } from "@/config/scenario";
import { DRIVER_EVENTS } from "@/data/events";
import { feedDaysActionableBy } from "@/data/feedDays";
import { seedDaily, type SeedDailyRow } from "@/data/index";
import { fmtDateShort, fmtIndex, fmtPings } from "@/lib/format";
import { clockLocal, useSimNow } from "@/lib/live/clock";
import { useSim } from "@/lib/live/store";
import { toVancouverIso, vancouverParts, vancouverToMs } from "@/lib/time";
import { useJumpTo } from "@/features/topbar/actions";
import { cn } from "@/lib/utils";
import { dayScale, monthStarts } from "./scale";

const SEEK_DEBOUNCE_MS = 300;
const MARKER_SEEK_HOUR = 9;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FILL: Record<Severity | "none", string> = {
  LOW: "fill-surge-low",
  MEDIUM: "fill-surge-medium",
  HIGH: "fill-surge-high",
  none: "fill-typical",
};
const STROKE: Record<Severity | "none", string> = {
  LOW: "stroke-surge-low",
  MEDIUM: "stroke-surge-medium",
  HIGH: "stroke-surge-high",
  none: "stroke-typical",
};

/** Width of an element that may mount later (a callback ref, so the observer attaches whenever it appears). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

const sevKey = (index: number | null | undefined): Severity | "none" => severityForIndex(index) ?? "none";

function Triangle({ x, y, sev, label, onSeek }: { x: number; y: number; sev: Severity | "none"; label: string; onSeek: () => void }) {
  return (
    <path
      d={`M${x} ${y - 4}L${x + 3.5} ${y + 3}L${x - 3.5} ${y + 3}Z`}
      strokeWidth={1}
      className={cn("cursor-pointer stroke-background", FILL[sev])}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSeek}
    >
      <title>{label}</title>
    </path>
  );
}

function Ring({ x, y, sev, label, onSeek }: { x: number; y: number; sev: Severity | "none"; label: string; onSeek: () => void }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={2.75}
      strokeWidth={1.5}
      className={cn("cursor-pointer fill-background", STROKE[sev])}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSeek}
    >
      <title>{label}</title>
    </circle>
  );
}

export function Timeline({ compact = false, className }: { compact?: boolean; className?: string }) {
  const clock = useSim((s) => s.clock);
  const selectedHubId = useSim((s) => s.selectedHubId);
  const nowMs = useSimNow(1000);
  const { jump } = useJumpTo();
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hatchId = useId().replace(/:/g, "");

  const minDate = clock ? vancouverParts(Date.parse(clock.min_time)).local_date : null;
  const maxDate = clock ? vancouverParts(Date.parse(clock.max_time)).local_date : null;
  const nowDate = Number.isFinite(nowMs) ? vancouverParts(nowMs).local_date : null;
  const scale = useMemo(() => (minDate && maxDate && width > 0 ? dayScale(minDate, maxDate, width) : null), [minDate, maxDate, width]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const lanes = useMemo(() => {
    if (!minDate || !maxDate) return [];
    return HUBS.map((h) => {
      const rows = seedDaily.filter((r) => r.hub_id === h.id && r.local_date >= minDate && r.local_date <= maxDate);
      return { hub: h, rows, max: Math.max(1, ...rows.map((r) => r.pings)) };
    });
  }, [minDate, maxDate]);

  const dispatchDays = useMemo(() => feedDaysActionableBy(nowMs), [nowMs]);

  const seekDate = (date: string, hour: number, label: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // The preview holds until the seek lands, so the handle doesn't jump back meanwhile.
    jump(toVancouverIso(vancouverToMs(date, hour)), { label }, () => setPreview(null));
  };
  const currentHour = clock ? clockLocal(clock).hour : 0;
  const commit = (date: string, debounce: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    const run = () => seekDate(date, currentHour, fmtDateShort(date));
    if (debounce) timer.current = setTimeout(run, SEEK_DEBOUNCE_MS);
    else run();
  };
  const seekMarker = (date: string) => {
    setPreview(date);
    seekDate(date, MARKER_SEEK_HOUR, `${fmtDateShort(date)} 09:00`);
  };

  if (!clock || !minDate || !maxDate) {
    return (
      <section aria-label="Timeline" className={cn("flex shrink-0 items-center border-t bg-background px-4", compact ? "h-14" : "h-[88px]", className)}>
        <Skeleton className="h-8 w-full" />
      </section>
    );
  }

  const shown = preview ?? nowDate ?? minDate;
  const eventsY = 0;
  const lanesTop = 7;
  const laneH = compact ? 18 : 14;
  const laneCount = compact ? 1 : 3;
  const lanesBottom = lanesTop + laneH * laneCount;
  const axisY = lanesBottom + 12;
  const svgH = axisY + 2;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!scale || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    setDragging(true);
    setPreview(scale.dateAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !scale) return;
    setPreview(scale.dateAt(e.clientX - e.currentTarget.getBoundingClientRect().left));
  };
  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    if (preview && preview !== nowDate) commit(preview, true);
    else setPreview(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!scale) return;
    const step = e.shiftKey ? 7 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setPreview(scale.shift(shown, e.key === "ArrowLeft" ? -step : step));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setPreview(e.key === "Home" ? scale.first : scale.last);
    } else if (e.key === "Enter" && preview) {
      e.preventDefault();
      commit(preview, false);
    } else if (e.key === "Escape" && preview) {
      e.preventDefault();
      if (timer.current) clearTimeout(timer.current);
      setPreview(null);
    }
  };

  const laneY = (i: number) => lanesTop + laneH * (compact ? 0 : i);
  const retroLabel = (r: SeedDailyRow) =>
    `${hubName(r.hub_id)}, ${fmtDateShort(r.local_date)}: surge day, ${fmtIndex(r.surge_index)} retrospective index, ${fmtPings(r.pings)} pings. Click to jump to 09:00.`;
  const hubIndex = (id: string) => HUBS.findIndex((h) => h.id === id);

  return (
    <section
      aria-label="Timeline"
      className={cn("flex shrink-0 flex-col border-t bg-background px-3 md:px-4", compact ? "h-14 justify-center" : "h-[88px] pt-1.5", className)}
    >
      {!compact && (
        <div className="hidden items-center justify-between gap-4 text-xs text-muted-foreground md:flex">
          <span className="font-semibold text-foreground">Daily pings per hub</span>
          <span className="flex min-w-0 items-center gap-3 truncate">
            <span className="hidden items-center gap-1 lg:flex">
              <svg width={9} height={9} aria-hidden>
                <path d="M4.5 1L8 8H1Z" className="fill-surge-high" />
              </svg>
              surge day
            </span>
            <span className="hidden items-center gap-1 lg:flex">
              <svg width={9} height={9} aria-hidden>
                <circle cx={4.5} cy={4.5} r={3} strokeWidth={1.5} className="fill-none stroke-surge-high" />
              </svg>
              dispatch events so far
            </span>
            <span className="truncate">Daily totals, each hub on its own scale. Surge markers use a retrospective index.</span>
          </span>
        </div>
      )}
      <div className="flex min-h-0 gap-2">
        <div className="w-[76px] shrink-0 text-xs text-muted-foreground" style={{ paddingTop: lanesTop }} aria-hidden>
          {compact ? (
            <div style={{ height: laneH, lineHeight: `${laneH}px` }}>All hubs</div>
          ) : (
            HUBS.map((h) => (
              <div
                key={h.id}
                className={cn("truncate", h.id === selectedHubId && "font-semibold text-foreground")}
                style={{ height: laneH, lineHeight: `${laneH}px` }}
              >
                {h.id === "waterfront" ? "Waterfront" : h.name}
              </div>
            ))
          )}
        </div>
        <div
          ref={plotRef}
          role="slider"
          tabIndex={0}
          aria-label="Simulation date"
          aria-valuemin={0}
          aria-valuemax={scale ? scale.days - 1 : 0}
          aria-valuenow={scale ? scale.index(shown) : 0}
          aria-valuetext={`${fmtDateShort(shown)}${preview && preview !== nowDate ? ", press Enter to jump" : ""}`}
          aria-describedby={`${hatchId}-help`}
          className="relative min-w-0 flex-1 cursor-ew-resize touch-none rounded-sm outline-offset-2 select-none focus-visible:outline-2 focus-visible:outline-ring"
          style={{ height: svgH }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            setDragging(false);
            setPreview(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (!timer.current) setPreview(null);
          }}
        >
          <span id={`${hatchId}-help`} className="sr-only">
            Left and right arrows move a day, with Shift a week. Enter jumps there.
          </span>
          {scale && (
            <svg width={width} height={svgH} className="absolute inset-0 overflow-visible" aria-hidden>
              <defs>
                <pattern id={hatchId} width={3} height={3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width={1.5} height={3} className="fill-muted-foreground" />
                </pattern>
              </defs>
              {/* exam periods (solid) and holidays (hatched) */}
              {DRIVER_EVENTS.filter((e) => e.end_date >= scale.first && e.start_date <= scale.last).map((e) => {
                const step = width / scale.days;
                const x0 = scale.x(e.start_date) - step / 2;
                const x1 = scale.x(e.end_date) + step / 2;
                return (
                  <rect
                    key={e.id}
                    x={x0}
                    y={eventsY}
                    width={Math.max(2, x1 - x0)}
                    height={4}
                    className={e.category === "EXAM" ? "fill-muted-foreground/35" : undefined}
                    fill={e.category === "HOLIDAY" ? `url(#${hatchId})` : undefined}
                  >
                    <title>{`${e.label}: ${fmtDateShort(e.start_date)}${e.end_date !== e.start_date ? ` – ${fmtDateShort(e.end_date)}` : ""} (${e.source_name})`}</title>
                  </rect>
                );
              })}
              {/* lane lines */}
              {!compact &&
                lanes.map(({ hub, rows, max }, i) => {
                  const top = laneY(i);
                  const d = rows
                    .map((r, j) => `${j === 0 ? "M" : "L"}${scale.x(r.local_date).toFixed(1)} ${(top + laneH - 2 - (r.pings / max) * (laneH - 5)).toFixed(1)}`)
                    .join("");
                  const selected = hub.id === selectedHubId;
                  return (
                    <path
                      key={hub.id}
                      d={d}
                      fill="none"
                      strokeWidth={selected ? 1.5 : 1}
                      className={selected ? "stroke-foreground" : "stroke-muted-foreground/70"}
                    />
                  );
                })}
              {compact && <line x1={0} x2={width} y1={lanesBottom - 1} y2={lanesBottom - 1} strokeWidth={1} className="stroke-border" />}
              {/* retrospective surge days */}
              {lanes.flatMap(({ rows }, i) =>
                rows
                  .filter((r) => r.is_surge)
                  .map((r) => (
                    <Triangle
                      key={`s-${r.hub_id}-${r.local_date}`}
                      x={scale.x(r.local_date)}
                      y={laneY(i) + laneH - 5}
                      sev={sevKey(r.surge_index)}
                      label={retroLabel(r)}
                      onSeek={() => seekMarker(r.local_date)}
                    />
                  )),
              )}
              {/* dispatch events that have become actionable */}
              {dispatchDays
                .filter((d) => d.local_date >= scale.first && d.local_date <= scale.last && hubIndex(d.hub_id) >= 0)
                .map((d) => (
                  <Ring
                    key={`d-${d.hub_id}-${d.local_date}`}
                    x={scale.x(d.local_date)}
                    y={laneY(hubIndex(d.hub_id)) + 3}
                    sev={sevKey(d.peak_index)}
                    label={`${hubName(d.hub_id)}, ${fmtDateShort(d.local_date)}: ${d.events} dispatch events, peak ${fmtIndex(d.peak_index)}${d.peak_at ? ` at ${d.peak_at}` : ""}. Click to jump to 09:00.`}
                    onSeek={() => seekMarker(d.local_date)}
                  />
                ))}
              {/* month axis: skip a label that would collide with the previous one */}
              {(() => {
                let lastRight = -Infinity;
                return monthStarts(scale.first, scale.last).map((m) => {
                  const month = +m.slice(5, 7);
                  const x = scale.x(m);
                  const text = month === 1 && width >= 560 ? `${MONTHS[0]} ${m.slice(0, 4)}` : MONTHS[month - 1];
                  const showLabel = x + 2 >= lastRight + 6;
                  if (showLabel) lastRight = x + 2 + text.length * 6.5;
                  return (
                    <g key={m}>
                      <line x1={x} x2={x} y1={lanesBottom} y2={lanesBottom + 3} strokeWidth={1} className="stroke-border" />
                      {showLabel && (
                        <text x={x + 2} y={axisY} className="fill-muted-foreground text-xs">
                          {text}
                        </text>
                      )}
                    </g>
                  );
                });
              })()}
              {/* now handle */}
              <g className="pointer-events-none">
                <line x1={scale.x(shown)} x2={scale.x(shown)} y1={-2} y2={lanesBottom} strokeWidth={2} className="stroke-foreground" />
                <circle cx={scale.x(shown)} cy={lanesBottom + 4} r={compact ? 5 : 6} strokeWidth={2} className="fill-foreground stroke-background" />
              </g>
            </svg>
          )}
          {scale && preview && preview !== nowDate && (
            <span
              className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-lg border bg-popover px-2 py-0.5 text-xs whitespace-nowrap shadow-float"
              style={{ left: Math.min(width - 40, Math.max(40, scale.x(preview))) }}
            >
              {fmtDateShort(preview)}
            </span>
          )}
        </div>
      </div>
      {!compact && (
        <p className="mt-1 text-xs text-muted-foreground md:hidden">
          Daily totals, each hub on its own scale. ▲ surge day (retrospective index), ○ dispatch events so far.
        </p>
      )}
    </section>
  );
}
