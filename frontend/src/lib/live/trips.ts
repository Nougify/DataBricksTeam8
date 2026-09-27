// Pure helpers over the live store's trips and dispatch events (v3 has no progress field, so progress and ETAs are
// derived from the trip's planned times and the extrapolated sim clock).
import type { AdditionalTrip, DispatchEvent, TripStatus } from "@/lib/api/schemas";

export const ACTIVE_TRIP_STATUSES: ReadonlySet<TripStatus> = new Set(["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE"]);

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/** The hub a trip serves, from its dispatch event (null for events away from the hubs or unknown events). */
export function tripHub(trip: AdditionalTrip, events: Readonly<Record<string, DispatchEvent>>): string | null {
  return events[trip.dispatch_event_id]?.hub_id ?? null;
}

/** PROPOSED trips, soonest approval expiry first (spec §8.2). */
export function approvalQueue(trips: Iterable<AdditionalTrip>): AdditionalTrip[] {
  return [...trips]
    .filter((t) => t.status === "PROPOSED")
    .sort((a, b) => ms(a.approval_expires_at) - ms(b.approval_expires_at) || a.id.localeCompare(b.id));
}

/** APPROVED, BUS_EN_ROUTE and IN_SERVICE trips, soonest service departure first. */
export function activeTrips(trips: Iterable<AdditionalTrip>): AdditionalTrip[] {
  const key = (t: AdditionalTrip) => ms(t.service_departure_time ?? t.dispatch_time ?? t.target_event_time);
  return [...trips].filter((t) => ACTIVE_TRIP_STATUSES.has(t.status)).sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

/** Whole sim-minutes until the proposal expires (0 once past), or null without a valid time. */
export function minutesLeft(trip: AdditionalTrip, nowMs: number): number | null {
  const end = ms(trip.approval_expires_at);
  if (!Number.isFinite(end) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.ceil((end - nowMs) / 60_000));
}

/** Fraction 0–1 of the trip done, from dispatch to estimated completion; null without both times. */
export function tripProgress(trip: AdditionalTrip, nowMs: number): number | null {
  const start = ms(trip.dispatch_time);
  const end = ms(trip.estimated_completion_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(nowMs) || end <= start) return null;
  return Math.min(1, Math.max(0, (nowMs - start) / (end - start)));
}

export interface TripEta {
  /** "Leaves", "Arrives", "Departs" or "Completes". */
  label: string;
  atMs: number;
}

/** The next milestone of an active trip: dispatch, arrival at the hub, service departure, or completion. */
export function tripEta(trip: AdditionalTrip, nowMs: number): TripEta | null {
  const steps: [string, string | null][] = [
    ["Leaves", trip.dispatch_time],
    ["Arrives", trip.estimated_arrival_time],
    ["Departs", trip.service_departure_time],
    ["Completes", trip.estimated_completion_time],
  ];
  for (const [label, iso] of steps) {
    const t = ms(iso);
    if (Number.isFinite(t) && t > nowMs) return { label, atMs: t };
  }
  const end = ms(trip.estimated_completion_time);
  return Number.isFinite(end) ? { label: "Completes", atMs: end } : null;
}
