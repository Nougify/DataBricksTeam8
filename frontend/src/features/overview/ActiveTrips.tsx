"use client";

// Active extra trips (spec §8.3): APPROVED, BUS_EN_ROUTE and IN_SERVICE, each with progress (dispatch → estimated
// completion on the extrapolated sim clock) and its next milestone.
import { useMemo } from "react";
import { EmptyState } from "@/components/EmptyState";
import { TripStatusBadge } from "@/components/TripStatusBadge";
import { Progress } from "@/components/ui/progress";
import { hubName } from "@/config/hubs";
import { fmtTime } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { useSim } from "@/lib/live/store";
import { activeTrips, tripEta, tripHub, tripProgress } from "@/lib/live/trips";
import { TripRoute } from "@/features/trips/TripRoute";

export function ActiveTrips({ hubId }: { hubId?: string }) {
  const trips = useSim((s) => s.trips);
  const events = useSim((s) => s.events);
  const nowMs = useSimNow(1000);
  const rows = useMemo(
    () =>
      activeTrips(Object.values(trips))
        .map((t) => ({ trip: t, hub: tripHub(t, events) }))
        .filter((r) => hubId === undefined || r.hub === hubId),
    [trips, events, hubId],
  );

  if (rows.length === 0) {
    return <EmptyState title="No extra trips running" description="Approved proposals show here until the trip completes." />;
  }

  return (
    <ul className="flex flex-col divide-y">
      {rows.map(({ trip, hub }) => {
        const progress = tripProgress(trip, nowMs);
        const eta = tripEta(trip, nowMs);
        const pct = progress === null ? null : Math.round(progress * 100);
        return (
          <li key={trip.id} className="flex flex-col gap-1.5 py-2.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold">{hub ? hubName(hub) : "Away from the hubs"}</span>
              <span className="flex items-center gap-1.5">
                {trip.bus_id} → extra <TripRoute trip={trip} /> trip
              </span>
              <TripStatusBadge status={trip.status} className="ml-auto" />
            </span>
            <span className="flex items-center gap-3">
              <Progress
                value={pct ?? 0}
                className="h-1.5 flex-1"
                aria-label={`${trip.bus_id} trip progress`}
                aria-valuetext={pct === null ? "Not started" : `${pct}% done`}
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {eta ? `${eta.label} ${fmtTime(eta.atMs)}` : "—"}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
