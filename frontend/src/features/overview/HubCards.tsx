"use client";

// Overview hub cards (spec §8.1): one ruled, clickable row per hub. Demand is the last full hour of arrivals from the
// bundled forecast snapshot; the surge line is the current or next surge episode from the visible dispatch events.
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { SeverityBadge, SeverityMark } from "@/components/SeverityBadge";
import { SourceNote } from "@/components/SourceNote";
import { Skeleton } from "@/components/ui/skeleton";
import { HUBS } from "@/config/hubs";
import { severityForIndex } from "@/config/scenario";
import { FORECAST_SOURCE } from "@/data/forecast";
import { FEED_SOURCE } from "@/data/feed";
import { fmtDuration, fmtIndex, fmtPings, fmtTime, hourLabel } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { useLastFullHour, type LastFullHour } from "@/lib/live/demand";
import { currentOrNextEpisode, episodePhase, useEpisodes, type SurgeEpisode } from "@/lib/live/episodes";
import { useSim } from "@/lib/live/store";
import { ACTIVE_TRIP_STATUSES, tripHub } from "@/lib/live/trips";

const pctVs = (a: number, b: number) => {
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
};

export function demandLine(last: LastFullHour | null): string {
  if (!last?.row || last.row.actual === null) return "No hourly pings for the last hour";
  const { actual, typical } = last.row;
  const window = `${hourLabel(last.hour)}–${hourLabel((last.hour + 1) % 24)}`;
  const vs = typical !== null && typical > 0 ? ` vs ${fmtPings(typical)} typical (${pctVs(actual, typical)})` : "";
  return `${fmtPings(actual)} pings, ${window}${vs}`;
}

/** "Surge now until 15:00, peak 1.99× at 13:00" / "Surge in 40 min (13:00), peak 1.79×". */
export function episodeLine(ep: SurgeEpisode, nowMs: number): string {
  const peak = ep.peakIndex !== null ? `, peak ${fmtIndex(ep.peakIndex)}` : "";
  if (episodePhase(ep, nowMs) === "ACTIVE") {
    return `Surge now until ${fmtTime(ep.endMs)}${peak}${ep.peakAtMs !== null && ep.peakAtMs > nowMs ? ` at ${fmtTime(ep.peakAtMs)}` : ""}`;
  }
  return `Surge in ${fmtDuration((ep.startMs - nowMs) / 60_000)} (${fmtTime(ep.startMs)})${peak}`;
}

export function HubCards() {
  const last = useLastFullHour("arrivals");
  const episodes = useEpisodes();
  const nowMs = useSimNow(1000);
  const trips = useSim((s) => s.trips);
  const events = useSim((s) => s.events);
  const selectHub = useSim((s) => s.selectHub);

  const counts = useMemo(() => {
    const out: Record<string, { pending: number; active: number }> = {};
    for (const t of Object.values(trips)) {
      const hub = tripHub(t, events);
      if (!hub) continue;
      const c = (out[hub] ??= { pending: 0, active: 0 });
      if (t.status === "PROPOSED") c.pending += 1;
      else if (ACTIVE_TRIP_STATUSES.has(t.status)) c.active += 1;
    }
    return out;
  }, [trips, events]);

  return (
    <div className="flex flex-col">
      <ul className="-mx-2 flex flex-col divide-y">
        {HUBS.map((hub) => {
          const l = last[hub.id];
          const index = l?.row?.actual_index ?? null;
          const indexSeverity = severityForIndex(index);
          const ep = Number.isFinite(nowMs) ? currentOrNextEpisode(episodes, hub.id, nowMs) : null;
          const c = counts[hub.id] ?? { pending: 0, active: 0 };
          const tripsLine = [
            c.pending > 0 ? `${c.pending} ${c.pending === 1 ? "proposal" : "proposals"} waiting` : null,
            c.active > 0 ? `${c.active} extra ${c.active === 1 ? "trip" : "trips"} active` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={hub.id}>
              <button
                type="button"
                onClick={() => selectHub(hub.id, "now")}
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-accent"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-heading text-lg leading-tight font-semibold">{hub.name}</span>
                    {l === null ? (
                      <Skeleton className="h-5 w-16" />
                    ) : (
                      <span className="flex items-center gap-1.5 font-heading text-lg leading-tight font-semibold">
                        {indexSeverity && <SeverityMark severity={indexSeverity} variant="disc" />}
                        {fmtIndex(index)}
                        <span className="sr-only"> surge index in the last full hour</span>
                      </span>
                    )}
                  </span>
                  {l === null ? <Skeleton className="h-4 w-56" /> : <span className="text-sm">{demandLine(l)}</span>}
                  {ep ? (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      {episodeLine(ep, nowMs)}
                      {ep.severity && <SeverityBadge severity={ep.severity} active={episodePhase(ep, nowMs) === "ACTIVE"} />}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">No surge forecast</span>
                  )}
                  {tripsLine && <span className="text-sm text-muted-foreground">{tripsLine}</span>}
                </span>
                <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
      <SourceNote className="mt-1" source={`${FORECAST_SOURCE} (arrivals, surge index = actual ÷ typical); surges: ${FEED_SOURCE}`} />
    </div>
  );
}
