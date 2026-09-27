"use client";

// Approval queue (spec §8.2, DESIGN.md §7.2 "departure board"): every PROPOSED trip, soonest expiry first. The
// countdown is in sim minutes and only moves while the sim runs. Preview arrives with map preview mode in M3.
import { useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { hubName } from "@/config/hubs";
import type { AdditionalTrip } from "@/lib/api/schemas";
import { fmtTime } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { useSim } from "@/lib/live/store";
import { approvalQueue, minutesLeft, tripHub } from "@/lib/live/trips";
import { cn } from "@/lib/utils";
import { TripRoute } from "@/features/trips/TripRoute";
import { useTripActions } from "@/features/trips/useTripActions";

const EXPIRES_SOON_MIN = 10;

function QueueRow({ trip, nowMs, hubId }: { trip: AdditionalTrip; nowMs: number; hubId: string | null }) {
  const { approve, reject, pending, approving, rejecting } = useTripActions(trip.id);
  const left = minutesLeft(trip, nowMs);
  const soon = left !== null && left < EXPIRES_SOON_MIN;
  const hub = hubId ? hubName(hubId) : "Away from the hubs";

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="flex w-16 shrink-0 flex-col items-end">
        <span className={cn("font-heading text-xl leading-tight", soon ? "font-bold" : "font-semibold")}>
          {left === null ? "—" : `${left} min`}
        </span>
        {soon && <span className="text-xs text-muted-foreground">expires soon</span>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{hub}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-sm">
          {trip.bus_id} → extra <TripRoute trip={trip} /> trip
          {trip.service_departure_time && <span className="text-muted-foreground">at {fmtTime(trip.service_departure_time)}</span>}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={approve} disabled={pending} aria-label={`Approve ${trip.bus_id} for ${hub}`}>
          {approving ? "Approving…" : "Approve"}
        </Button>
        <Button size="sm" variant="outline" onClick={reject} disabled={pending} aria-label={`Reject ${trip.bus_id} for ${hub}`}>
          {rejecting ? "Rejecting…" : "Reject"}
        </Button>
      </span>
    </li>
  );
}

export function ApprovalQueue({ empty, hubId }: { empty: ReactNode; hubId?: string }) {
  const trips = useSim((s) => s.trips);
  const events = useSim((s) => s.events);
  const nowMs = useSimNow(1000);
  const rows = useMemo(
    () =>
      approvalQueue(Object.values(trips))
        .map((t) => ({ trip: t, hub: tripHub(t, events) }))
        .filter((r) => hubId === undefined || r.hub === hubId),
    [trips, events, hubId],
  );

  if (rows.length === 0) return <>{empty}</>;
  return (
    <ul className="flex flex-col divide-y" aria-label="Proposals waiting for approval">
      {rows.map(({ trip, hub }) => (
        <QueueRow key={trip.id} trip={trip} hubId={hub} nowMs={nowMs} />
      ))}
    </ul>
  );
}
