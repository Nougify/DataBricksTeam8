"use client";

import { useState, type ReactNode } from "react";
import { BusFront, ChevronDown, Clock3, MapPinned, Route, Users } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { SourceNote } from "@/components/SourceNote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { isApiError } from "@/lib/api/client";
import { TRIP_CONFLICT_MESSAGES, useApproveTrip, useRejectTrip } from "@/lib/api/hooks";
import type { AdditionalTrip, Bus, DispatchEvent, MovementPlan } from "@/lib/api/schemas";
import { fmtDate, fmtDuration, fmtIndex, fmtPings, fmtTime } from "@/lib/format";
import { useSim } from "@/lib/live/store";

const humanize = (value: string) => value.toLowerCase().replaceAll("_", " ");

function StatusBadge({ status }: { status: string }) {
  const failed = ["REJECTED", "EXPIRED", "CANCELLED", "INVALID_SOURCE", "NO_MATCHING_ROUTE", "NO_BUS_AVAILABLE"].includes(status);
  const active = ["AWAITING_APPROVAL", "APPROVED", "BUS_EN_ROUTE", "IN_SERVICE", "DISPATCHED", "RESERVED", "DEADHEADING", "WAITING", "RETURNING", "REPOSITIONING"].includes(status);
  return (
    <Badge variant={failed ? "destructive" : "outline"} className={active && !failed ? "border-trip-active/40 text-trip-active" : undefined}>
      {humanize(status)}
    </Badge>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible className="group/detail border-t border-border/70 pt-2">
      <CollapsibleTrigger className="flex min-h-7 w-full items-center justify-between rounded-sm text-left text-xs font-semibold hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {label}
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-data-[state=open]/detail:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function EventSource({ event }: { event: DispatchEvent }) {
  const source = [event.source.split, event.source.direction, event.source.version].filter(Boolean).join(" / ") || "Dispatch event feed";
  return (
    <Detail label="Source provenance">
      <SourceNote source={source} href={event.source.link} />
      {event.source.generated_at && (
        <p className="mt-1 text-xs text-muted-foreground">Generated {fmtDate(event.source.generated_at)} at {fmtTime(event.source.generated_at)}</p>
      )}
    </Detail>
  );
}

function Recommendation({ event }: { event: DispatchEvent }) {
  const top = event.recommendations[0];
  const otherFailures = event.recommendations.slice(1).filter((item) => item.mapping_status === "INVALID");
  return (
    <div className="rounded-lg bg-muted/55 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">Top recommendation</p>
          <p className="mt-1 font-medium">Route {top.source_route} to {top.destination}</p>
        </div>
        <Badge variant="secondary">{top.destination_share.toFixed(1)}%</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {top.extra_bus_trips_est} extra {top.extra_bus_trips_est === 1 ? "trip" : "trips"} · priority {top.priority_score}
      </p>
      {top.mapping_status === "INVALID" ? (
        <div role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <span className="font-semibold">Recommendation mapping failed: {humanize(top.failure_code ?? "invalid")}</span>
          {top.failure_reason && <p className="mt-0.5">{top.failure_reason}</p>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Mapping {humanize(top.mapping_status)}{top.route_id ? ` · ${top.route_id}` : ""}
        </p>
      )}
      {otherFailures.map((item) => (
        <div key={`${item.source_route}:${item.destination}`} role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <span className="font-semibold">Route {item.source_route} mapping failed: {humanize(item.failure_code ?? "invalid")}</span>
          {item.failure_reason && <p className="mt-0.5">{item.failure_reason}</p>}
        </div>
      ))}
    </div>
  );
}

export function EventsView({ events }: { events: DispatchEvent[] }) {
  if (!events.length) return <EmptyState title="No dispatch events" description="No events match the current hub filter." />;
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <Card key={event.id} size="sm">
          <CardHeader>
            <CardTitle className="flex items-start justify-between gap-2">
              <span>{event.source_location}</span>
              <StatusBadge status={event.status} />
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {humanize(event.mode)} · actionable {fmtDate(event.actionable_at)} {fmtTime(event.actionable_at)} · event {fmtTime(event.event_time)}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
              <Fact label="Predicted">{fmtPings(event.predicted_people)}</Fact>
              <Fact label="Normal">{fmtPings(event.normal_people)}</Fact>
              <Fact label="Ratio">{fmtIndex(event.surge_ratio)}</Fact>
              <Fact label="Suggested buses">{event.suggested_extra_buses}</Fact>
            </dl>
            <Recommendation event={event} />
            <EventSource event={event} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function decisionError(error: unknown): string {
  if (isApiError(error)) return TRIP_CONFLICT_MESSAGES[error.code] ?? error.message;
  return error instanceof Error ? error.message : "The request failed.";
}

function ProposalCard({ trip, event, bus }: { trip: AdditionalTrip; event?: DispatchEvent; bus?: Bus }) {
  const approve = useApproveTrip();
  const reject = useRejectTrip();
  const startPreview = useSim((state) => state.startPreview);
  const exitPreview = useSim((state) => state.exitPreview);
  const previewing = useSim((state) => state.previewTripId === trip.id);
  const [error, setError] = useState<string | null>(null);
  const pending = approve.isPending || reject.isPending;
  const routeSource = bus?.source.type === "ROUTE" ? bus.source.route?.short_name : bus?.source.depot_name;

  const decide = (action: "approve" | "reject") => {
    setError(null);
    const mutation = action === "approve" ? approve : reject;
    mutation.mutate({ tripId: trip.id }, {
      onSuccess: () => {
        if (previewing) exitPreview();
        toast.success(action === "approve" ? "Proposal approved" : "Proposal rejected");
      },
      onError: (reason) => setError(decisionError(reason)),
    });
  };

  return (
    <Card size="sm" className="border-l-3 border-l-trip-proposed">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <span>Route {trip.source_route ?? trip.route_id} to {trip.destination ?? event?.source_location ?? "destination"}</span>
          <StatusBadge status={trip.status} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">Expires {fmtDate(trip.approval_expires_at)} at {fmtTime(trip.approval_expires_at)}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Bus">{bus?.id ?? trip.bus_id}</Fact>
          <Fact label="Capacity">+{trip.added_capacity}</Fact>
          <Fact label="From">{routeSource ?? "Source unavailable"}</Fact>
          <Fact label="Target">{fmtTime(trip.target_event_time)}</Fact>
        </dl>
        <p className="text-sm text-muted-foreground">{trip.rationale}</p>
        {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={previewing}
          onClick={() => previewing ? exitPreview() : startPreview(trip.id)}
          disabled={pending}
        >
          <MapPinned aria-hidden /> {previewing ? "Close preview" : "Preview"}
        </Button>
        <Button size="sm" onClick={() => decide("approve")} disabled={pending}>Approve</Button>
        <Button size="sm" variant="destructive" onClick={() => decide("reject")} disabled={pending}>Reject</Button>
      </CardFooter>
    </Card>
  );
}

export function ProposalsView({ proposals, events, buses }: { proposals: AdditionalTrip[]; events: Record<string, DispatchEvent>; buses: Record<string, Bus> }) {
  if (!proposals.length) return <EmptyState title="No proposals waiting" description="New bus proposals appear here when an event requires operational action." />;
  return <div className="space-y-3">{proposals.map((trip) => <ProposalCard key={trip.id} trip={trip} event={events[trip.dispatch_event_id]} bus={buses[trip.bus_id]} />)}</div>;
}

function PlanDetails({ plan }: { plan: MovementPlan }) {
  const legs = [plan.deadhead, plan.service, plan.return_leg];
  return (
    <div className="space-y-3 text-xs">
      <dl className="grid grid-cols-2 gap-3">
        <Fact label="Dispatch">{fmtTime(plan.dispatch_time)}</Fact>
        <Fact label="Arrival">{fmtTime(plan.estimated_arrival_time)}</Fact>
        <Fact label="Service departure">{fmtTime(plan.service_departure_time)}</Fact>
        <Fact label="Return">{fmtTime(plan.estimated_return_time)}</Fact>
        <Fact label="Waiting">{fmtDuration(plan.waiting_seconds / 60)}</Fact>
        <Fact label="Arrival lateness">{fmtDuration(plan.arrival_lateness_seconds / 60)}</Fact>
      </dl>
      <div className="space-y-2">
        {legs.map((leg) => (
          <div key={leg.kind} className="rounded-md bg-muted/55 p-2">
            <p className="font-semibold">{humanize(leg.kind)} · {(leg.distance_m / 1000).toFixed(1)} km · {fmtDuration(leg.duration_seconds / 60)}</p>
            <SourceNote source={`${leg.provenance.provider}: ${leg.provenance.method}${leg.provenance.is_approximation ? " (approximation)" : ""}`} className="mt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TripsView({ trips, events }: { trips: AdditionalTrip[]; events: Record<string, DispatchEvent> }) {
  if (!trips.length) return <EmptyState title="No additional trips" description="No trip lifecycle records match the current hub filter." />;
  return (
    <div className="space-y-3">
      {trips.map((trip) => {
        const event = events[trip.dispatch_event_id];
        return (
          <Card key={trip.id} size="sm">
            <CardHeader>
              <CardTitle className="flex items-start justify-between gap-2"><span>{trip.bus_id} · {trip.source_route ?? trip.route_id}</span><StatusBadge status={trip.status} /></CardTitle>
              <p className="text-xs text-muted-foreground">{event?.source_location ?? trip.destination ?? trip.dispatch_event_id}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="grid grid-cols-2 gap-3">
                <Fact label="Proposed">{fmtTime(trip.proposed_at)}</Fact>
                <Fact label="Dispatch">{fmtTime(trip.dispatch_time)}</Fact>
                <Fact label="Arrival">{fmtTime(trip.estimated_arrival_time)}</Fact>
                <Fact label="Completion">{fmtTime(trip.estimated_completion_time)}</Fact>
              </dl>
              <p className="text-sm text-muted-foreground">{trip.rationale}</p>
              {trip.movement_plan ? <Detail label="Movement plan"><PlanDetails plan={trip.movement_plan} /></Detail> : <p className="border-t pt-2 text-xs text-muted-foreground">Movement plan not available.</p>}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function FleetView({ buses, trips }: { buses: Bus[]; trips: Record<string, AdditionalTrip> }) {
  const setTab = useSim((state) => state.setTab);
  const setFocusTrip = useSim((state) => state.setFocusTrip);
  if (!buses.length) return <EmptyState title="No fleet vehicles" description="No buses are present in the current simulation state." />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Fleet is network-wide because vehicle records do not include a hub assignment.</p>
      {buses.map((bus) => {
        const tripId = bus.assigned_trip_id ?? bus.proposed_trip_id;
        const trip = tripId ? trips[tripId] : undefined;
        const source = bus.source.type === "ROUTE" && bus.source.route
          ? `Route ${bus.source.route.short_name}${bus.source.route.long_name ? ` · ${bus.source.route.long_name}` : ""}`
          : bus.source.depot_name ?? "Depot";
        return (
          <Card key={bus.id} size="sm">
            <CardHeader>
              <CardTitle className="flex items-start justify-between gap-2"><span className="flex items-center gap-2"><BusFront aria-hidden className="size-4" />{bus.id}</span><StatusBadge status={bus.status} /></CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3">
                <Fact label="Source">{source}</Fact>
                <Fact label="Capacity">{bus.capacity}</Fact>
                <Fact label="Trip link">
                  {trip ? (
                    <Button variant="link" size="xs" className="h-auto p-0" onClick={() => { setFocusTrip(trip.id); setTab("trips"); }}>
                      {trip.id} · {humanize(trip.status)}
                    </Button>
                  ) : tripId ?? "Unassigned"}
                </Fact>
                <Fact label="Source type">{humanize(bus.source.type)}</Fact>
              </dl>
              {bus.source.type === "ROUTE" && bus.source.route && (
                <SourceNote source={<span className="inline-flex items-center gap-1"><Route aria-hidden className="size-3" />{bus.source.route.route_id}</span>} className="mt-3" />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function SummaryStrip({ events, proposals, activeTrips, availableBuses }: { events: number; proposals: number; activeTrips: number; availableBuses: number }) {
  const items = [
    { label: "Events", value: events, icon: Clock3 },
    { label: "Proposals", value: proposals, icon: Users },
    { label: "Active trips", value: activeTrips, icon: Route },
    { label: "Buses ready", value: availableBuses, icon: BusFront },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="bg-card px-3 py-2">
          <dt className="flex items-center gap-1 text-[0.68rem] font-medium tracking-wide text-muted-foreground uppercase"><Icon aria-hidden className="size-3" />{label}</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
