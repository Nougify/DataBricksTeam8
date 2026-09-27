// MockSim (spec §12.2, DECISIONS.md "MockSim (v3)"): an in-browser replica of the v3 backend's coordinator
// (backend/app/services). It replays the bundled Databricks dispatch feed with the backend's rules:
//
// - Events activate at `actionable_at` (available_at when proactive), ordered by actionable_at, event_time,
//   priority desc, id. Each activation tries the event's resolved recommendations in priority order.
// - Bus count = ceil(extra_bus_trips_est) of the first recommendation with a feasible bus, capped at 3 per event
//   and by free buses. Zero creates no proposal (NO_ACTION_REQUIRED); no feasible bus gives NO_BUS_AVAILABLE.
// - Proposals reserve their bus and expire after 30 sim-min; the clock auto-pauses on a proposal.
//   Reject or expiry releases the bus. Approval replans at the current time, then the bus deadheads, waits,
//   runs the service leg, completes and returns home.
// - Seek rebuilds from the initial fleet and replays through the target (with recorded human decisions),
//   so the same seek always gives the same state and ids.
//
// Mock-only deviations (DECISIONS.md "Mock-only deviations"): state keeps the last 24 sim-hours of events, and
// service legs run at 20 km/h along the representative shape.
import { DEFAULT_START_TIME } from "@/config/scenario";
import { feedManifest, loadFeedMonth, monthOf, nextMonth, prevMonth, type FeedEvent } from "@/data/feed";
import type {
  AdditionalTrip,
  Bus,
  Clock,
  ClockReason,
  DispatchEvent,
  EventStatus,
  GeoPoint,
  LineString,
  Meta,
  MovementLeg,
  MovementPlan,
  Speed,
  StateResponse,
  TripStatus,
  WsMessage,
} from "@/lib/api/schemas";
import { SPEEDS } from "@/lib/api/schemas";
import { HOUR_MS, MINUTE_MS, toVancouverIso, vancouverParts, vancouverToMs } from "@/lib/time";
import { distanceKm, type Coord } from "./geo";
import {
  FLEET,
  FLEET_SOURCE,
  MAX_BUSES_PER_EVENT,
  candidateGeometry,
  initialFleet,
  resolveFeedEvent,
  type BusRecord,
} from "./network";
import { hashString } from "./rng";
import { MockApiError, type MockFrame, type MockSimApi } from "./types";

export const MIN_TIME = "2025-11-15T00:00:00-08:00";
export const MAX_TIME = "2026-08-31T23:00:00-07:00";
export const DEFAULT_SPEED: Speed = 60;
export const APPROVAL_TIMEOUT_MIN = 30;
export const RETENTION_MS = 24 * HOUR_MS;
const DEADHEAD_KPH = 30;
const SERVICE_KPH = 20;

// Boundary priorities, as in backend/app/services/clock.py BoundaryPriority. Recorded decisions replay last.
const P_ACTIVATION = 10;
const P_EXPIRY = 40;
const P_DISPATCH = 50;
const P_MOVEMENT = 60;
const P_COMPLETION = 70;
const P_RETURN = 80;
const P_DECISION = 100;

const RATIONALE = "Selected first feasible recommendation; ranked by arrival, deadhead distance, route, pattern, and bus.";

const STRAIGHT_LINE = {
  provider: "straight_line",
  is_approximation: true,
  method: "great-circle distance at configured constant speed",
  speed_kph: DEADHEAD_KPH,
} as const;
const MOCK_SERVICE = {
  provider: "mock",
  is_approximation: true,
  method: "representative GTFS trip stops at a constant 20 km/h (mock mode)",
  speed_kph: SERVICE_KPH,
} as const;

interface Decision {
  tripId: string;
  eventId: string;
  busId: string;
  action: "APPROVE" | "REJECT";
  atMs: number;
}

interface Due {
  atMs: number;
  priority: number;
  key: string;
  run: () => void;
}

interface Failure {
  failure: string;
}

export interface MockSimOptions {
  /** Wall clock, injectable for tests. */
  now?: () => number;
  /** Feed month loader, injectable for tests. */
  loadMonth?: (month: string) => Promise<FeedEvent[]>;
  /** Initial sim time (ISO). Default DEFAULT_START_TIME. */
  startTime?: string;
}

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => toVancouverIso(t);
const ACTIVE: ReadonlySet<TripStatus> = new Set(["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE"]);
const TERMINAL: ReadonlySet<TripStatus> = new Set(["COMPLETED", "REJECTED", "EXPIRED", "CANCELLED"]);

const toCoord = (p: GeoPoint): Coord => [p.lon, p.lat];
const toPoint = (c: Coord): GeoPoint => ({ lat: c[1], lon: c[0] });
const metres = (a: Coord, b: Coord) => distanceKm(a, b) * 1000;

function bearing(a: Coord, b: Coord): number | null {
  if (a[0] === b[0] && a[1] === b[1]) return null;
  const rad = Math.PI / 180;
  const dl = (b[0] - a[0]) * rad;
  const y = Math.sin(dl) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(dl);
  const deg = ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
  return deg >= 360 ? 0 : deg;
}

function pathLength(coords: readonly Coord[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += metres(coords[i - 1], coords[i]);
  return s;
}

/** Location and heading `fraction` of the way along a path (backend movement._interpolate_path). */
function interpolate(path: LineString, fraction: number): { location: GeoPoint; heading: number | null } {
  const c = path.coordinates as Coord[];
  const lengths = c.slice(1).map((p, i) => metres(c[i], p));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return { location: toPoint(c[c.length - 1]), heading: null };
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (len <= 0) continue;
    if (target <= walked + len || i === lengths.length - 1) {
      const t = Math.min(1, Math.max(0, (target - walked) / len));
      const a = c[i];
      const b = c[i + 1];
      return { location: { lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t }, heading: bearing(a, b) };
    }
    walked += len;
  }
  return { location: toPoint(c[c.length - 1]), heading: null };
}

function lineOf(coords: Coord[]): LineString {
  const out: Coord[] = [];
  for (const p of coords) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length === 1) out.push(out[0]);
  return { type: "LineString", coordinates: out.map((p) => [p[0], p[1]] as [number, number]) };
}

function straightLeg(kind: "DEADHEAD" | "RETURN", from: GeoPoint, to: GeoPoint): MovementLeg {
  const path = lineOf([toCoord(from), toCoord(to)]);
  const distance = metres(toCoord(from), toCoord(to));
  return {
    kind,
    path,
    distance_m: distance,
    duration_seconds: Math.ceil(distance / ((DEADHEAD_KPH * 1000) / 3600)),
    provenance: { ...STRAIGHT_LINE },
  };
}

function nearestVertexFrom(coords: readonly Coord[], p: Coord, from: number): number {
  let best = from;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = from; i < coords.length; i++) {
    const d = distanceKm(coords[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** 20-hex-digit stable id, like the backend's sha256-based trip ids. */
function stableId(identity: string): string {
  const a = hashString(identity, 1).toString(16).padStart(14, "0");
  const b = hashString(identity, 2).toString(16).padStart(14, "0");
  return (a + b).slice(0, 20);
}

function eventOrder(a: DispatchEvent, b: DispatchEvent): number {
  return (
    ms(a.actionable_at) - ms(b.actionable_at) ||
    ms(a.event_time) - ms(b.event_time) ||
    b.priority_score - a.priority_score ||
    a.id.localeCompare(b.id)
  );
}

export class MockSim implements MockSimApi {
  private readonly wall: () => number;
  private readonly loadMonth: (month: string) => Promise<FeedEvent[]>;
  private readonly minMs = ms(MIN_TIME);
  private readonly maxMs = ms(MAX_TIME);

  // clock
  private cur: number;
  private speed: Speed = DEFAULT_SPEED;
  private status: "RUNNING" | "PAUSED" = "PAUSED";
  private epoch = 0;
  private seq = 0;
  private anchorWall: number;

  // repositories
  private events = new Map<string, DispatchEvent>();
  private trips = new Map<string, AdditionalTrip>();
  private buses = new Map<string, BusRecord>();
  private decisions: Decision[] = [];

  // feed
  private schedule: DispatchEvent[] = [];
  private readonly loaded = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();

  // emission and control
  private replaying = false;
  private autoPauseRequested = false;
  private busy = false;
  private seekToken = 0;
  private lastPrunedHour = -1;
  private readonly listeners = new Set<(frame: MockFrame) => void>();
  private readonly dropListeners = new Set<() => void>();
  private ready: Promise<void>;

  constructor(opts: MockSimOptions = {}) {
    this.wall = opts.now ?? (() => Date.now());
    this.loadMonth = opts.loadMonth ?? loadFeedMonth;
    this.cur = ms(opts.startTime ?? DEFAULT_START_TIME);
    this.anchorWall = this.wall();
    for (const b of initialFleet()) this.buses.set(b.bus.id, b);
    this.ready = this.ensureMonths(this.cur - RETENTION_MS - HOUR_MS, this.cur + 2 * 24 * HOUR_MS).then(() => {
      this.rebuild(this.cur);
    });
  }

  /** Resolves once the initial feed months are loaded and the start state is built. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  // ---------- reads ----------

  getClock(): Clock {
    const p = vancouverParts(this.cur);
    return {
      current_time: iso(this.cur),
      local_date: p.local_date,
      hour: p.hour,
      speed: this.speed,
      status: this.status,
      min_time: iso(this.minMs),
      max_time: iso(this.maxMs),
      approval_mode: "MANUAL",
      auto_pause_on_proposal: true,
      epoch: this.epoch,
    };
  }

  getMeta(): Meta {
    return {
      data_mode: "exported_events",
      source_identity: feedManifest.table,
      source_version: feedManifest.source_version,
      integration_status: "ready",
      integration_error: null,
      event_window: {
        source_identity: feedManifest.table,
        source_version: feedManifest.source_version,
        window_start: iso(this.minMs),
        window_end: iso(this.maxMs),
        loaded_at: iso(Date.parse(feedManifest.pulled_at)),
        row_count: feedManifest.rows,
        provenance: "bundled Databricks snapshot (mock mode)",
      },
      simulation_bounds: { min_time: iso(this.minMs), max_time: iso(this.maxMs) },
      supported_speeds: [...SPEEDS],
      gtfs_version: "fall-2026",
      fleet: {
        size: FLEET.length,
        total_capacity: FLEET.reduce((s, b) => s + b.capacity, 0),
        source: FLEET_SOURCE,
        max_buses_per_event: MAX_BUSES_PER_EVENT,
      },
      approval_mode: "MANUAL",
    };
  }

  getState(): StateResponse {
    return {
      epoch: this.epoch,
      last_seq: this.seq,
      simulation: this.getClock(),
      dispatch_events: [...this.events.values()],
      buses: this.listBuses(),
      additional_trips: [...this.trips.values()],
    };
  }

  listDispatchEvents(filters: { from?: string; to?: string; hub_id?: string; status?: EventStatus } = {}): DispatchEvent[] {
    const from = filters.from ? ms(filters.from) : null;
    const to = filters.to ? ms(filters.to) : null;
    return [...this.events.values()].filter(
      (e) =>
        (from === null || ms(e.event_time) >= from) &&
        (to === null || ms(e.event_time) < to) &&
        (!filters.hub_id || e.hub_id === filters.hub_id) &&
        (!filters.status || e.status === filters.status),
    );
  }

  getDispatchEvent(eventId: string): DispatchEvent | undefined {
    const e = this.events.get(eventId);
    return e && ms(e.actionable_at) <= this.cur ? e : undefined;
  }

  listBuses(): Bus[] {
    return [...this.buses.values()].map((b) => this.project(b.bus));
  }

  getBus(busId: string): Bus | undefined {
    const b = this.buses.get(busId);
    return b ? this.project(b.bus) : undefined;
  }

  listTrips(): AdditionalTrip[] {
    return [...this.trips.values()];
  }

  getTrip(tripId: string): AdditionalTrip | undefined {
    return this.trips.get(tripId);
  }

  // ---------- live channel ----------

  connect(fn: (frame: MockFrame) => void): () => void {
    fn(this.getState());
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dropConnections(): void {
    for (const fn of [...this.dropListeners]) fn();
  }

  onDropConnections(fn: () => void): () => void {
    this.dropListeners.add(fn);
    return () => this.dropListeners.delete(fn);
  }

  private emit(type: WsMessage["type"], data: unknown, simMs = this.cur): void {
    if (this.replaying) return;
    const msg = { type, seq: ++this.seq, epoch: this.epoch, simulation_time: iso(simMs), data } as WsMessage;
    for (const fn of [...this.listeners]) fn(msg);
  }

  private emitClock(reason: ClockReason | null): void {
    this.emit("clock.updated", { ...this.getClock(), reason });
  }

  // ---------- clock commands ----------

  /** Brings the clock up to wall time (backend SimulationClockController.pump). */
  step(wallNow: number = this.wall()): void {
    if (this.busy) return;
    const elapsed = Math.max(0, wallNow - this.anchorWall);
    this.anchorWall = wallNow;
    if (this.status !== "RUNNING" || elapsed === 0) return;

    let target = Math.min(this.maxMs, this.cur + elapsed * this.speed);
    const covered = this.coveredUntil();
    if (target > covered) {
      // The next feed month is still loading: hold at the edge of what's loaded rather than skip its events.
      target = Math.max(this.cur, covered);
      void this.ensureMonths(this.cur, this.cur + 2 * 24 * HOUR_MS);
    }
    this.advanceTo(target);
    if (this.status !== "RUNNING") return;
    this.cur = target;
    if (target >= this.maxMs) {
      this.status = "PAUSED";
      this.emitClock(null);
      this.emitClock("PAUSED");
      return;
    }
    this.pruneIfNewHour();
    this.emitClock(null);
  }

  pause(): Clock {
    this.step();
    if (this.status === "PAUSED") return this.getClock();
    this.status = "PAUSED";
    this.anchorWall = this.wall();
    this.emitClock("PAUSED");
    return this.getClock();
  }

  resume(): Clock {
    if (this.status === "RUNNING" || this.cur >= this.maxMs) return this.getClock();
    this.status = "RUNNING";
    this.anchorWall = this.wall();
    this.emitClock("RESUMED");
    return this.getClock();
  }

  setSpeed(speed: Speed): Clock {
    if (!(SPEEDS as readonly number[]).includes(speed)) throw new MockApiError(422, "VALIDATION_ERROR", "Request validation failed");
    this.step();
    if (this.speed === speed) return this.getClock();
    this.speed = speed;
    this.anchorWall = this.wall();
    this.emitClock("SPEED");
    return this.getClock();
  }

  async seek(time: string): Promise<Clock> {
    const target = ms(time);
    if (!Number.isFinite(target) || target < this.minMs || target > this.maxMs) {
      throw new MockApiError(400, "HTTP_ERROR", "seek time must be within simulation bounds");
    }
    const token = ++this.seekToken;
    this.busy = true;
    try {
      await this.ready;
      await this.ensureMonths(target - RETENTION_MS - HOUR_MS, target + 2 * 24 * HOUR_MS);
      if (token !== this.seekToken) return this.getClock();
      // Seeking backward permanently discards decisions after the target (backend replay.py).
      this.decisions = this.decisions.filter((d) => d.atMs <= target);
      this.epoch += 1;
      this.rebuild(target);
      this.anchorWall = this.wall();
      this.emit("system.reset", { epoch: this.epoch, reason: "SEEK" });
      return this.getClock();
    } finally {
      if (token === this.seekToken) this.busy = false;
    }
  }

  // ---------- decisions ----------

  approve(tripId: string): AdditionalTrip {
    this.step();
    const result = this.approveTransition(tripId);
    this.decisions.push({ tripId, eventId: result.trip.dispatch_event_id, busId: result.trip.bus_id, action: "APPROVE", atMs: this.cur });
    if (result.conflict) throw new MockApiError(409, "HTTP_ERROR", result.conflict);
    return result.trip;
  }

  reject(tripId: string): AdditionalTrip {
    this.step();
    const trip = this.rejectTransition(tripId);
    this.decisions.push({ tripId, eventId: trip.dispatch_event_id, busId: trip.bus_id, action: "REJECT", atMs: this.cur });
    return trip;
  }

  private approveTransition(tripId: string): { trip: AdditionalTrip; conflict?: string } {
    const trip = this.trips.get(tripId);
    if (!trip) throw new MockApiError(404, "NOT_FOUND", "additional trip not found");
    if (trip.status === "APPROVED" || trip.status === "BUS_EN_ROUTE" || trip.status === "IN_SERVICE" || trip.status === "COMPLETED") {
      return { trip };
    }
    if (trip.status !== "PROPOSED") throw new MockApiError(409, "HTTP_ERROR", "trip is not proposed");
    if (this.cur >= ms(trip.approval_expires_at)) throw new MockApiError(409, "HTTP_ERROR", "proposal has expired");
    const busRec = this.buses.get(trip.bus_id);
    const event = this.events.get(trip.dispatch_event_id);
    if (!busRec || busRec.bus.proposed_trip_id !== trip.id || !event) {
      throw new MockApiError(409, "HTTP_ERROR", "proposal reservation is inconsistent");
    }
    if (!trip.selected_candidate) throw new MockApiError(409, "HTTP_ERROR", "proposal candidate is missing");

    const planned = this.compose(event, trip.selected_candidate, busRec, this.cur);
    if ("failure" in planned || ms(planned.estimated_return_time) > this.maxMs) {
      const cancelled = this.finishProposal(trip, "CANCELLED");
      return { trip: cancelled, conflict: "failure" in planned ? planned.failure : "movement plan exceeds simulation bounds" };
    }
    const approved: AdditionalTrip = {
      ...trip,
      status: "APPROVED",
      dispatch_time: planned.dispatch_time,
      estimated_arrival_time: planned.estimated_arrival_time,
      service_departure_time: planned.service_departure_time,
      estimated_completion_time: planned.estimated_completion_time,
      movement_plan: planned,
    };
    const bus: Bus = { ...busRec.bus, proposed_trip_id: null, assigned_trip_id: trip.id, status: "RESERVED" };
    this.trips.set(trip.id, approved);
    this.buses.set(bus.id, { ...busRec, bus });
    const updatedEvent = this.aggregate(event);
    this.emit("proposal.updated", approved);
    this.emit("bus.updated", bus);
    this.emit("dispatch_event.updated", updatedEvent);
    this.advanceTrip(trip.id);
    return { trip: this.trips.get(trip.id)! };
  }

  private rejectTransition(tripId: string): AdditionalTrip {
    const trip = this.trips.get(tripId);
    if (!trip) throw new MockApiError(404, "NOT_FOUND", "additional trip not found");
    if (trip.status === "REJECTED") return trip;
    if (trip.status !== "PROPOSED") throw new MockApiError(409, "HTTP_ERROR", "trip is not proposed");
    return this.finishProposal(trip, "REJECTED");
  }

  private finishProposal(trip: AdditionalTrip, status: TripStatus): AdditionalTrip {
    const busRec = this.buses.get(trip.bus_id);
    const event = this.events.get(trip.dispatch_event_id);
    if (!busRec || !event || busRec.bus.proposed_trip_id !== trip.id) {
      throw new MockApiError(409, "HTTP_ERROR", "proposal reservation is inconsistent");
    }
    const finished: AdditionalTrip = { ...trip, status };
    const released: Bus = { ...busRec.bus, status: "AVAILABLE", proposed_trip_id: null, assigned_trip_id: null };
    this.trips.set(trip.id, finished);
    this.buses.set(released.id, { ...busRec, bus: released });
    const updatedEvent = this.aggregate(event);
    this.emit("proposal.updated", finished);
    this.emit("bus.updated", released);
    this.emit("dispatch_event.updated", updatedEvent);
    return finished;
  }

  /** backend/app/services/trip_status.py aggregate_dispatch_event; stores and returns the event. */
  private aggregate(event: DispatchEvent): DispatchEvent {
    const statuses = new Set(event.additional_trip_ids.map((id) => this.trips.get(id)?.status).filter(Boolean) as TripStatus[]);
    let status: EventStatus;
    if ([...statuses].some((s) => ACTIVE.has(s))) status = "DISPATCHED";
    else if (statuses.has("COMPLETED")) status = statuses.has("PROPOSED") ? "DISPATCHED" : "COMPLETED";
    else if (statuses.has("PROPOSED")) status = "AWAITING_APPROVAL";
    else if (statuses.has("REJECTED")) status = "REJECTED";
    else if (statuses.has("EXPIRED")) status = "EXPIRED";
    else status = "NO_BUS_AVAILABLE";
    const updated = { ...event, status };
    this.events.set(event.id, updated);
    return updated;
  }

  // ---------- activation and proposals ----------

  private activate(base: DispatchEvent): void {
    if (this.events.has(base.id)) return;
    this.events.set(base.id, base);
    if (base.status === "INVALID_SOURCE" || base.status === "NO_MATCHING_ROUTE") {
      this.emit("dispatch_event.updated", base);
      return;
    }
    const available = [...this.buses.values()].filter(
      (b) => b.bus.status === "AVAILABLE" && b.bus.proposed_trip_id === null && b.bus.assigned_trip_id === null,
    );

    let chosen: { rec: DispatchEvent["recommendations"][number]; choices: { busRec: BusRecord; plan: MovementPlan }[] } | null = null;
    for (const rec of base.recommendations) {
      if (rec.mapping_status !== "RESOLVED") continue;
      const requested = Math.ceil(rec.extra_bus_trips_est);
      if (requested === 0) {
        const updated = { ...base, status: "NO_ACTION_REQUIRED" as const, suggested_extra_buses: 0, priority_score: rec.priority_score };
        this.events.set(base.id, updated);
        this.emit("dispatch_event.updated", updated);
        return;
      }
      const choices: { busRec: BusRecord; plan: MovementPlan; candidateKey: string }[] = [];
      for (const candidate of rec.candidates ?? []) {
        for (const busRec of available) {
          const plan = this.compose(base, candidate, busRec, this.cur);
          if ("failure" in plan || ms(plan.estimated_return_time) > this.maxMs) continue;
          choices.push({ busRec, plan, candidateKey: `${candidate.route_id}|${candidate.pattern_id}` });
        }
      }
      choices.sort(
        (a, b) =>
          ms(a.plan.estimated_arrival_time) - ms(b.plan.estimated_arrival_time) ||
          a.plan.deadhead.distance_m - b.plan.deadhead.distance_m ||
          a.candidateKey.localeCompare(b.candidateKey) ||
          a.busRec.bus.id.localeCompare(b.busRec.bus.id),
      );
      const seen = new Set<string>();
      const unique = choices.filter((c) => !seen.has(c.busRec.bus.id) && (seen.add(c.busRec.bus.id), true));
      if (unique.length > 0) {
        chosen = { rec, choices: unique };
        break;
      }
    }

    if (!chosen) {
      const updated = { ...base, status: "NO_BUS_AVAILABLE" as const };
      this.events.set(base.id, updated);
      this.emit("dispatch_event.updated", updated);
      return;
    }

    const count = Math.min(Math.ceil(chosen.rec.extra_bus_trips_est), MAX_BUSES_PER_EVENT, chosen.choices.length);
    const expires = Math.min(this.cur + APPROVAL_TIMEOUT_MIN * MINUTE_MS, this.maxMs);
    if (expires <= this.cur) {
      const updated = { ...base, status: "EXPIRED" as const };
      this.events.set(base.id, updated);
      this.emit("dispatch_event.updated", updated);
      return;
    }

    const tripIds: string[] = [];
    for (const { busRec, plan } of chosen.choices.slice(0, count)) {
      const candidate = chosen.rec.candidates![0];
      const id = `trip-${stableId(
        ["v1", base.id, chosen.rec.source_route, chosen.rec.destination, candidate.route_id, candidate.pattern_id, candidate.source_stop_id, candidate.destination_stop_id, busRec.bus.id].join("|"),
      )}`;
      const trip: AdditionalTrip = {
        id,
        dispatch_event_id: base.id,
        bus_id: busRec.bus.id,
        route_id: candidate.route_id,
        status: "PROPOSED",
        proposed_at: iso(this.cur),
        approval_expires_at: iso(expires),
        dispatch_time: null,
        target_event_time: base.event_time,
        estimated_arrival_time: plan.estimated_arrival_time,
        service_departure_time: plan.service_departure_time,
        estimated_completion_time: plan.estimated_completion_time,
        added_capacity: busRec.bus.capacity,
        rationale: RATIONALE,
        source_priority: chosen.rec.priority_score,
        source_route: chosen.rec.source_route,
        destination: chosen.rec.destination,
        selected_candidate: candidate,
        movement_plan: plan,
      };
      const bus: Bus = { ...busRec.bus, status: "RESERVED", proposed_trip_id: id, assigned_trip_id: null };
      this.trips.set(id, trip);
      this.buses.set(bus.id, { ...busRec, bus });
      tripIds.push(id);
      this.emit("proposal.created", trip);
      this.emit("bus.updated", bus);
    }
    const updated: DispatchEvent = {
      ...base,
      status: "AWAITING_APPROVAL",
      additional_trip_ids: tripIds,
      suggested_extra_buses: Math.ceil(chosen.rec.extra_bus_trips_est),
      priority_score: chosen.rec.priority_score,
    };
    this.events.set(base.id, updated);
    this.emit("dispatch_event.updated", updated);
    this.autoPauseRequested = true;
  }

  /** backend/app/routing/planner.py ItineraryComposer.compose, with MockSim's leg speeds. */
  private compose(
    event: DispatchEvent,
    candidate: NonNullable<AdditionalTrip["selected_candidate"]>,
    busRec: BusRecord,
    planning: number,
  ): MovementPlan | Failure {
    const geo = candidateGeometry(candidate);
    if (!geo || geo.stops.length < 2) return { failure: `candidate pattern not found: ${candidate.pattern_id}` };
    const src = geo.stops[0];
    const dst = geo.stops[geo.stops.length - 1];
    const srcPoint = { lat: src.lat, lon: src.lon };
    const dstPoint = { lat: dst.lat, lon: dst.lon };

    const deadhead = straightLeg("DEADHEAD", busRec.bus.location, srcPoint);
    const si = nearestVertexFrom(geo.shape, toCoord(srcPoint), 0);
    const di = nearestVertexFrom(geo.shape, toCoord(dstPoint), si);
    const servicePath = lineOf([toCoord(srcPoint), ...geo.shape.slice(si + 1, di + 1), toCoord(dstPoint)]);
    const serviceDistance = pathLength(servicePath.coordinates as Coord[]);
    const service: MovementLeg = {
      kind: "SERVICE",
      path: servicePath,
      distance_m: serviceDistance,
      duration_seconds: Math.ceil(serviceDistance / ((SERVICE_KPH * 1000) / 3600)),
      provenance: { ...MOCK_SERVICE },
    };
    const returnLeg = straightLeg("RETURN", dstPoint, busRec.home);

    const eventMs = ms(event.event_time);
    const dispatch = event.mode === "REACTIVE" ? Math.max(planning, eventMs) : planning;
    const arrival = dispatch + deadhead.duration_seconds * 1000;
    const lateness = Math.max(0, Math.ceil((arrival - eventMs) / 1000));
    if (event.mode === "PROACTIVE" && lateness > 0) {
      return { failure: `arrival is ${lateness} seconds after proactive target` };
    }
    const departure = event.mode === "PROACTIVE" ? Math.max(arrival, eventMs) : arrival;
    const completion = departure + service.duration_seconds * 1000;
    const returned = completion + returnLeg.duration_seconds * 1000;
    return {
      route_id: candidate.route_id,
      pattern_id: candidate.pattern_id,
      source_stop_id: candidate.source_stop_id,
      destination_stop_id: candidate.destination_stop_id,
      reference_scheduled_trip_id: candidate.scheduled_trip_ids[0],
      mode: event.mode,
      deadhead,
      service,
      return_leg: returnLeg,
      dispatch_time: iso(dispatch),
      estimated_arrival_time: iso(arrival),
      service_departure_time: iso(departure),
      estimated_completion_time: iso(completion),
      estimated_return_time: iso(returned),
      waiting_seconds: Math.max(0, Math.ceil((departure - arrival) / 1000)),
      arrival_lateness_seconds: lateness,
      total_distance_m: deadhead.distance_m + service.distance_m + returnLeg.distance_m,
    };
  }

  // ---------- movement (backend/app/services/movement.py) ----------

  private advanceTrip(tripId: string): void {
    let trip = this.trips.get(tripId);
    if (!trip?.movement_plan) return;
    const busRec = this.buses.get(trip.bus_id);
    if (!busRec || busRec.bus.assigned_trip_id !== trip.id) return;
    const plan = trip.movement_plan;
    let bus = busRec.bus;
    const now = this.cur;
    const put = () => {
      this.trips.set(trip!.id, trip!);
      this.buses.set(bus.id, { ...busRec, bus });
    };

    if (trip.status === "APPROVED" && ms(plan.dispatch_time) <= now) {
      trip = { ...trip, status: "BUS_EN_ROUTE" };
      bus = this.atLegStart(bus, "DEADHEADING", plan.deadhead);
      put();
      this.emit("trip.updated", trip);
      this.emit("bus.updated", bus);
    }
    if (trip.status === "BUS_EN_ROUTE" && bus.status === "DEADHEADING" && ms(plan.estimated_arrival_time) <= now) {
      bus = this.atLegEnd(bus, "WAITING", plan.deadhead);
      put();
      if (ms(plan.service_departure_time) > now) this.emit("bus.updated", bus);
    }
    if (trip.status === "BUS_EN_ROUTE" && ms(plan.service_departure_time) <= now) {
      trip = { ...trip, status: "IN_SERVICE" };
      bus = this.atLegStart(bus, "IN_SERVICE", plan.service);
      put();
      this.emit("trip.updated", trip);
      this.emit("bus.updated", bus);
    }
    if (trip.status === "IN_SERVICE" && ms(plan.estimated_completion_time) <= now) {
      trip = { ...trip, status: "COMPLETED" };
      bus = this.atLegStart(this.atLegEnd(bus, "RETURNING", plan.service), "RETURNING", plan.return_leg);
      put();
      this.emit("trip.updated", trip);
      this.emit("bus.updated", bus);
      const event = this.events.get(trip.dispatch_event_id);
      if (event) this.emit("dispatch_event.updated", this.aggregate(event));
    }
    if (trip.status === "COMPLETED" && bus.assigned_trip_id === trip.id && ms(plan.estimated_return_time) <= now) {
      bus = { ...this.atLegEnd(bus, "AVAILABLE", plan.return_leg), assigned_trip_id: null, heading_deg: null, location: { ...busRec.home } };
      put();
      this.emit("bus.updated", bus);
    }
  }

  private atLegStart(bus: Bus, status: Bus["status"], leg: MovementLeg): Bus {
    const { location, heading } = interpolate(leg.path, 0);
    return { ...bus, status, location, heading_deg: heading };
  }

  private atLegEnd(bus: Bus, status: Bus["status"], leg: MovementLeg): Bus {
    const c = leg.path.coordinates[leg.path.coordinates.length - 1];
    return { ...bus, status, location: { lon: c[0], lat: c[1] }, heading_deg: null };
  }

  /** The next movement boundary for a trip (backend _next_registration), or null. */
  private nextMilestone(trip: AdditionalTrip): { atMs: number; priority: number } | null {
    const plan = trip.movement_plan;
    const bus = this.buses.get(trip.bus_id)?.bus;
    if (!plan || !bus || bus.assigned_trip_id !== trip.id) return null;
    if (trip.status === "APPROVED") return { atMs: ms(plan.dispatch_time), priority: P_DISPATCH };
    if (trip.status === "BUS_EN_ROUTE" && bus.status === "DEADHEADING") return { atMs: ms(plan.estimated_arrival_time), priority: P_MOVEMENT };
    if (trip.status === "BUS_EN_ROUTE") return { atMs: ms(plan.service_departure_time), priority: P_MOVEMENT };
    if (trip.status === "IN_SERVICE") return { atMs: ms(plan.estimated_completion_time), priority: P_COMPLETION };
    if (trip.status === "COMPLETED") return { atMs: ms(plan.estimated_return_time), priority: P_RETURN };
    return null;
  }

  /** The bus as GET /buses shows it: interpolated along its current leg (backend project_bus). */
  private project(bus: Bus): Bus {
    const trip = bus.assigned_trip_id ? this.trips.get(bus.assigned_trip_id) : undefined;
    const plan = trip?.movement_plan;
    if (!plan) return bus;
    const along = (leg: MovementLeg, start: string, end: string) => {
      const duration = ms(end) - ms(start);
      const f = duration <= 0 ? 1 : Math.min(1, Math.max(0, (this.cur - ms(start)) / duration));
      const { location, heading } = interpolate(leg.path, f);
      return { ...bus, location, heading_deg: heading };
    };
    switch (bus.status) {
      case "DEADHEADING":
        return along(plan.deadhead, plan.dispatch_time, plan.estimated_arrival_time);
      case "WAITING":
        return this.atLegEnd(bus, "WAITING", plan.deadhead);
      case "IN_SERVICE":
        return along(plan.service, plan.service_departure_time, plan.estimated_completion_time);
      case "RETURNING":
        return along(plan.return_leg, plan.estimated_completion_time, plan.estimated_return_time);
      default:
        return bus;
    }
  }

  // ---------- boundary loop ----------

  /** Every boundary strictly after `after`, grouped by the earliest time. */
  private nextDue(after: number): Due[] {
    const due: Due[] = [];
    let at = Number.POSITIVE_INFINITY;
    const offer = (d: Due) => {
      if (d.atMs <= after) return;
      if (d.atMs < at) {
        at = d.atMs;
        due.length = 0;
      }
      if (d.atMs === at) due.push(d);
    };

    // Activations: the schedule is sorted by actionable_at.
    let lo = 0;
    let hi = this.schedule.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ms(this.schedule[mid].actionable_at) <= after) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.schedule.length; i++) {
      const e = this.schedule[i];
      const t = ms(e.actionable_at);
      if (t > at) break;
      if (!this.events.has(e.id)) offer({ atMs: t, priority: P_ACTIVATION, key: `activate:${e.id}`, run: () => this.activate(e) });
    }

    for (const trip of this.trips.values()) {
      if (trip.status === "PROPOSED") {
        const t = ms(trip.approval_expires_at);
        offer({
          atMs: t,
          priority: P_EXPIRY,
          key: `expire:${trip.id}`,
          run: () => {
            const current = this.trips.get(trip.id);
            if (current?.status === "PROPOSED") this.finishProposal(current, "EXPIRED");
          },
        });
      } else if (!TERMINAL.has(trip.status) || trip.status === "COMPLETED") {
        const next = this.nextMilestone(trip);
        if (next) offer({ ...next, key: `move:${trip.id}`, run: () => this.advanceTrip(trip.id) });
      }
    }

    if (this.replaying) {
      for (const d of this.decisions) {
        offer({
          atMs: d.atMs,
          priority: P_DECISION,
          key: `decision:${d.tripId}:${d.action}`,
          run: () => {
            const trip = this.trips.get(d.tripId);
            if (!trip || trip.bus_id !== d.busId || trip.dispatch_event_id !== d.eventId) return;
            try {
              if (d.action === "APPROVE") this.approveTransition(d.tripId);
              else this.rejectTransition(d.tripId);
            } catch {
              // A decision that no longer applies (e.g. the proposal already expired) is skipped.
            }
          },
        });
      }
    }

    return due.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  }

  /** Processes every boundary up to and including `target`, stopping early on an auto-pause. */
  private advanceTo(target: number): void {
    for (;;) {
      const due = this.nextDue(this.cur);
      if (due.length === 0 || due[0].atMs > target) break;
      this.cur = due[0].atMs;
      this.autoPauseRequested = false;
      for (const d of due) d.run();
      if (this.autoPauseRequested && !this.replaying && this.status === "RUNNING") {
        this.status = "PAUSED";
        this.anchorWall = this.wall();
        this.emitClock("AUTO_PAUSE_PROPOSAL");
        return;
      }
    }
    if (this.cur < target) this.cur = target;
  }

  /** Rebuilds state at `target` from the initial fleet, replaying the last 24 h (no messages emitted). */
  private rebuild(target: number): void {
    this.replaying = true;
    try {
      this.events.clear();
      this.trips.clear();
      this.buses.clear();
      for (const b of initialFleet()) this.buses.set(b.bus.id, b);
      this.status = "PAUSED";
      this.cur = Math.max(this.minMs, target - RETENTION_MS) - 1;
      this.advanceTo(target);
      this.cur = target;
      this.lastPrunedHour = Math.floor(target / HOUR_MS);
    } finally {
      this.replaying = false;
      this.autoPauseRequested = false;
    }
  }

  /** Drops events (and their finished trips) that became actionable more than 24 sim-hours ago. */
  private pruneIfNewHour(): void {
    const hour = Math.floor(this.cur / HOUR_MS);
    if (hour === this.lastPrunedHour) return;
    this.lastPrunedHour = hour;
    const cutoff = this.cur - RETENTION_MS;
    for (const [id, e] of this.events) {
      if (ms(e.actionable_at) >= cutoff) continue;
      const trips = e.additional_trip_ids.map((t) => this.trips.get(t));
      const busy = trips.some((t) => t && (!TERMINAL.has(t.status) || this.buses.get(t.bus_id)?.bus.assigned_trip_id === t.id));
      if (busy) continue;
      this.events.delete(id);
      for (const t of e.additional_trip_ids) this.trips.delete(t);
    }
  }

  // ---------- feed loading ----------

  /** Everything before this instant has its feed months loaded (actionable_at can precede event_time by ~1 h). */
  private coveredUntil(): number {
    let month = monthOf(iso(this.cur));
    while (this.loaded.has(month)) month = nextMonth(month);
    // The start of the first unloaded month, minus a margin for the longest available_at lead.
    return vancouverToMs(`${month}-01`, 0) - 2 * HOUR_MS;
  }

  private ensureMonths(fromMs: number, toMs: number): Promise<void> {
    const months: string[] = [];
    let month = prevMonth(iso(Math.max(this.minMs, fromMs)).slice(0, 7));
    const last = iso(Math.min(this.maxMs, toMs)).slice(0, 7);
    for (;;) {
      months.push(month);
      if (month >= last) break;
      month = nextMonth(month);
    }
    months.push(nextMonth(last));
    return Promise.all(months.map((m) => this.loadMonthOnce(m))).then(() => undefined);
  }

  private loadMonthOnce(month: string): Promise<void> {
    if (this.loaded.has(month)) return Promise.resolve();
    let p = this.loading.get(month);
    if (!p) {
      p = this.loadMonth(month).then(
        (rows) => {
          this.loaded.add(month);
          this.loading.delete(month);
          if (rows.length === 0) return;
          this.schedule = [...this.schedule, ...rows.map(resolveFeedEvent)].sort(eventOrder);
        },
        (err: unknown) => {
          this.loading.delete(month);
          throw err;
        },
      );
      this.loading.set(month, p);
    }
    return p;
  }
}
