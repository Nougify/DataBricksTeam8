"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeta, useTimeline } from "@/lib/api/hooks";
import type { DayType } from "@/lib/api/schemas";
import { fmtClock } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { dayTypeOf, toVancouverIso, vancouverParts } from "@/lib/time";
import { cn } from "@/lib/utils";

// Used only until /meta has loaded (or if it fails), so the badge never flashes empty.
const FALLBACK_DAY_TYPE_LABELS: Record<DayType, string> = {
  mf: "Weekday",
  sat: "Saturday",
  sun_hol: "Sunday / holiday",
};

/**
 * Day type for a Vancouver date: from /timeline when loaded (it knows the pipeline's holidays), otherwise
 * from the calendar and the BC holiday list. Labels come from /meta.day_types.
 */
function useDayTypeLabel(localDate: string | null): string | null {
  const timeline = useTimeline();
  const meta = useMeta();
  const byDate = useMemo(
    () => new Map((timeline.data?.days ?? []).map((d) => [d.local_date, d.day_type] as const)),
    [timeline.data],
  );
  if (!localDate) return null;
  const id = byDate.get(localDate) ?? dayTypeOf(localDate);
  return meta.data?.day_types.find((d) => d.id === id)?.label ?? FALLBACK_DAY_TYPE_LABELS[id];
}

/**
 * The sim clock (spec §6): weekday, date, 24 h time and PST/PDT in America/Vancouver, plus a day-type
 * badge. It extrapolates smoothly between server ticks while running (useSimNow). Before the first
 * snapshot it shows a static skeleton of the same size.
 *
 * Layout by width: phone stacks "13:20 PST" over "Sat Dec 6"; tablet reads "Sat Dec 6 13:20 PST" with the
 * badge from 1024 px; desktop adds the year.
 */
export function SimClock({ className }: { className?: string }) {
  const nowMs = useSimNow();
  const valid = Number.isFinite(nowMs);
  const localDate = valid ? vancouverParts(nowMs).local_date : null;
  const dayType = useDayTypeLabel(localDate);

  if (!valid) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Skeleton className="h-8 w-20 md:w-44 xl:w-56" />
        <span className="sr-only">Simulation time not loaded yet</span>
      </div>
    );
  }

  const parts = fmtClock(nowMs);
  const [month, day, year] = parts.date.split(" ");

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <time
        dateTime={toVancouverIso(nowMs)}
        aria-label={`Simulation time: ${parts.weekday} ${parts.date}, ${parts.time} ${parts.tz}`}
        className="flex flex-col leading-none md:flex-row md:items-baseline md:gap-2"
      >
        <span className="order-2 mt-1 text-xs text-muted-foreground md:order-1 md:mt-0 md:font-heading md:text-lg md:leading-none md:font-medium md:text-foreground">
          {parts.weekday} {month} {day}
          <span className="hidden xl:inline"> {year}</span>
        </span>
        <span className="order-1 flex items-baseline gap-1 md:order-2">
          <span className="font-heading text-xl leading-none font-semibold md:text-2xl">{parts.time}</span>
          <span className="text-xs text-muted-foreground md:text-sm">{parts.tz}</span>
        </span>
      </time>
      {dayType && (
        <Badge variant="secondary" className="hidden lg:inline-flex">
          {dayType}
        </Badge>
      )}
    </div>
  );
}
