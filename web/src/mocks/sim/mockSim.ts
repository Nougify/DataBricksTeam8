// MockSim: the in-browser simulator behind mock mode (spec §12.2, message.txt §0.1, §8b, §9b, §11b, §12).
// A deterministic state machine keyed by sim time. It owns the clock (epoch, seq, speed, auto-pause), the
// scripted surges and their proposals, trips and buses, and emits contract-exact WebSocket envelopes.
//
// Time model: while RUNNING, sim time = anchorSim + (wall − anchorWall) × speed. Every public read first
// "syncs", processing each scheduled event in time order up to that target, so REST and WS always agree.
// Events only fire in sim time, so nothing expires while paused.
import type {
  AdditionalTrip,
  AdditionalTripDetail,
  Bus,
  BusPosition,
  BusStatus,
  Clock,
  HubStatus,
  PredictedDestination,
  StateChangedReason,
  StateResponse,
  Surge,
  SurgePhase,
  SurgeStatus,
  TripStatus,
  WsMessage,
} from "@/lib/api/schemas";
import { HOUR_MS, MINUTE_MS, isoToMs, startOfVancouverHour, toVancouverIso, vancouverParts } from "@/lib/time";
import { SEED_HUB_IDS } from "@/mocks/data";
import { pointAtFraction, type Coord } from "./geo";
import {
  BUS_CAPACITY,
  NONHUB_LOCATION,
  NONHUB_NAME,
  PROPOSAL_TTL_MS,
  getWorld,
  looperPosition,
  loopingBuses,
  severityFor,
  type BusDef,
  type LooperDef,
  type ScenarioDef,
  type TripTemplate,
} from "./scenarios";
import { synth as defaultSynth } from "./synth";
import { MockApiError, type MockSimApi, type SynthApi } from "./types";

export const DEFAULT_START_TIME = "2026-02-11T13:00:00-08:00";
export const MIN_TIME = "2025-11-15T00:00:00-08:00";
export const MAX_TIME = "2026-08-31T23:00:00-07:00";
export const ALLOWED_SPEEDS: readonly number[] = [1, 60, 300, 900, 3600];
export const DEFAULT_SPEED = 60;
/** trip.updated for progress alone goes out at most this often per trip (wall ms). */
const PROGRESS_EVERY_MS = 1000;
/** On a huge catch-up (e.g. a throttled background tab), only the last few hour boundaries emit hub.demand_updated. */
const MAX_HOUR_CATCHUP = 6;

export interface MockSimOptions {
  /** Wall clock (ms). Tests inject a fake. */
  now?: () => number;
  synth?: SynthApi;
  startTime?: string;
  /** Dev flag ?mock_nonhub=1: a non-hub surge at Broadway-City Hall 2–4 h after the (seek) time. */
  nonHub?: boolean;
  /** Dev flag ?mock_buses=N: N extra REPOSITIONING buses looping along real routes. */
  extraBuses?: number;
}

// ---------- internal records ----------

interface SurgeRec {
  id: string;
  hubId: string | null;
  locationName: string;
  location: { lat: number; lon: number };
  localDate: string;
  detectedMs: number;
  windowStartMs: number;
  windowEndMs: number;
  magnitude: Surge["magnitude"];
  severity: Surge["severity"];
  drivers: Surge["drivers"];
  destinations: PredictedDestination[];
  templates: TripTemplate[];
  /** Resolution values, computed when the window ends. */
  resolve: () => { pings: number; surge_index: number };
  status: SurgeStatus;
  phase: SurgePhase;
  tripIds: string[];
  actual: { pings: number; surge_index: number } | null;
}

interface TripRec {
  tpl: TripTemplate;
  surgeId: string;
  hubId: string | null;
  status: TripStatus;
  proposedMs: number;
  expiresMs: number;
  dispatchMs: number;
  arrivalMs: number;
  departureMs: number;
  completionMs: number;
  windowStartMs: number;
  lastProgressWall: number;
  lastProgressSent: number;
}

interface BusRec {
  def: BusDef | null;
  looper: LooperDef | null;
  id: string;
  source: Bus["source"];
  status: BusStatus;
  assignedTripId: string | null;
  proposedTripId: string | null;
  returning: { path: Coord[]; startMs: number; endMs: number } | null;
}

type EvKind = "detect" | "expire" | "dispatch" | "arrive" | "depart" | "complete" | "home" | "windowStart" | "windowEnd";
interface Ev {
  t: number;
  n: number;
  kind: EvKind;
  /** Scenario id (detect), trip id, bus id (home) or surge id (window events). */
  ref: string;
}

const ACTIVE_TRIP: ReadonlySet<TripStatus> = new Set(["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE"]);
const APPROVED_EVER: ReadonlySet<TripStatus> = new Set(["APPROVED", "BUS_EN_ROUTE", "IN_SERVICE", "COMPLETED"]);

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const frac = (t: number, a: number, b: number) => (b <= a ? 1 : Math.min(1, Math.max(0, (t - a) / (b - a))));
const toLatLon = (c: Coord) => ({ lat: Math.round(c[1] * 1e5) / 1e5, lon: Math.round(c[0] * 1e5) / 1e5 });
const lineString = (coords: Coord[]) => ({ type: "LineString" as const, coordinates: coords.map((c) => [c[0], c[1]] as [number, number]) });

export class MockSim implements MockSimApi {
  private readonly now: () => number;
  private readonly synth: SynthApi;
  private readonly nonHub: boolean;
  private readonly loopers: LooperDef[];
  private readonly minMs = isoToMs(MIN_TIME);
  private readonly maxMs = isoToMs(MAX_TIME);

  private epoch = 1;
  private seq = 0;
  private status: "RUNNING" | "PAUSED" = "PAUSED";
  private speed = DEFAULT_SPEED;
  private autoPause = true;
  private simMs: number;
  private anchorSim: number;
  private anchorWall: number;
  private nextHourMs = 0;

  private surges = new Map<string, SurgeRec>();
  private trips = new Map<string, TripRec>();
  private buses = new Map<string, BusRec>();
  private queue: Ev[] = [];
  private evCounter = 0;

  private readonly subscribers = new Set<(msg: WsMessage) => void>();
  private readonly dropListeners = new Set<() => void>();

  constructor(opts: MockSimOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.synth = opts.synth ?? defaultSynth;
    this.nonHub = opts.nonHub ?? false;
    this.loopers = loopingBuses(Math.max(0, Math.min(200, Math.floor(opts.extraBuses ?? 0))));
    const start = isoToMs(opts.startTime ?? DEFAULT_START_TIME);
    this.simMs = start;
    this.anchorSim = start;
    this.anchorWall = this.now();
    this.rebuild(start);
  }

  // ======================================================================
  // Public API
  // ======================================================================

  getClock(): Clock {
    this.sync();
    return this.clock();
  }

  nowMs(): number {
    this.sync();
    return this.simMs;
  }

  getState(): StateResponse {
    this.sync();
    return {
      epoch: this.epoch,
      last_seq: this.seq,
      simulation: this.clock(),
      hubs: SEED_HUB_IDS.map((h) => this.hubStatus(h, this.simMs)),
      surges: this.listSurgesNoSync(),
      buses: [...this.buses.values()].map((b) => this.busOut(b)),
      additional_trips: [...this.trips.values()].map((t) => this.tripOut(t)),
    };
  }

  pause(): Clock {
    this.sync();
    if (this.status === "RUNNING") {
      this.status = "PAUSED";
      this.emitClock("PAUSED");
    }
    return this.clock();
  }

  resume(): Clock {
    this.sync();
    if (this.status === "PAUSED" && this.simMs < this.maxMs) {
      this.status = "RUNNING";
      this.reanchor();
      this.emitClock("RESUMED");
    }
    return this.clock();
  }

  setSpeed(speed: number): Clock {
    if (typeof speed !== "number" || !ALLOWED_SPEEDS.includes(speed)) {
      throw new MockApiError(400, "INVALID_SPEED", `Speed must be one of ${ALLOWED_SPEEDS.join(", ")}.`);
    }
    this.sync();
    this.speed = speed;
    this.reanchor();
    this.emitClock("SPEED");
    return this.clock();
  }

  seek(iso: string): Clock {
    const t = typeof iso === "string" ? isoToMs(iso) : Number.NaN;
    if (!Number.isFinite(t)) throw new MockApiError(400, "INVALID_TIME", "current_time must be an ISO 8601 time with an offset.");
    if (t < this.minMs || t > this.maxMs) {
      throw new MockApiError(400, "OUT_OF_RANGE", `Time must be between ${MIN_TIME} and ${MAX_TIME}.`);
    }
    this.rebuild(t);
    this.epoch += 1;
    this.reanchor();
    this.emit("state.reset", { epoch: this.epoch, reason: "SEEK" });
    return this.clock();
  }

  setSettings(s: { auto_pause_on_proposal: boolean }): Clock {
    this.sync();
    this.autoPause = Boolean(s.auto_pause_on_proposal);
    this.emitClock("SETTINGS");
    return this.clock();
  }

  approve(tripId: string, epoch: number): AdditionalTrip {
    this.sync();
    const trip = this.mustTrip(tripId);
    this.checkEpoch(trip, epoch);
    switch (trip.status) {
      case "APPROVED":
        return this.tripOut(trip);
      case "PROPOSED":
        break;
      case "REJECTED":
        throw this.conflict("TRIP_REJECTED", "This proposal was already rejected.", trip);
      case "EXPIRED":
        throw this.conflict("TRIP_EXPIRED", `Proposal expired at ${hhmm(trip.expiresMs)} before it was approved.`, trip);
      default:
        throw this.conflict("TRIP_NOT_PROPOSED", `Trip is ${trip.status}, not PROPOSED.`, trip);
    }
    if (this.simMs > trip.dispatchMs) this.retime(trip, this.simMs);
    trip.status = "APPROVED";
    this.emit("dispatch.approved", this.tripOut(trip));

    const bus = this.buses.get(trip.tpl.busId);
    if (bus) {
      bus.status = "DEADHEADING";
      bus.assignedTripId = trip.tpl.id;
      bus.proposedTripId = null;
      bus.returning = null;
      this.emit("bus.updated", this.busOut(bus));
    }
    const surge = this.surges.get(trip.surgeId);
    if (surge) {
      surge.status = "DISPATCHED";
      this.emit("surge.updated", this.surgeOut(surge));
    }
    this.schedule(trip.dispatchMs, "dispatch", trip.tpl.id);
    this.schedule(trip.arrivalMs, "arrive", trip.tpl.id);
    this.schedule(trip.departureMs, "depart", trip.tpl.id);
    this.schedule(trip.completionMs, "complete", trip.tpl.id);
    return this.tripOut(trip);
  }

  reject(tripId: string, epoch: number, _reason?: string): AdditionalTrip {
    void _reason;
    this.sync();
    const trip = this.mustTrip(tripId);
    this.checkEpoch(trip, epoch);
    switch (trip.status) {
      case "REJECTED":
        return this.tripOut(trip);
      case "PROPOSED":
        break;
      case "EXPIRED":
        throw this.conflict("TRIP_EXPIRED", `Proposal expired at ${hhmm(trip.expiresMs)}.`, trip);
      default:
        throw this.conflict("TRIP_NOT_PROPOSED", `Trip is ${trip.status}, not PROPOSED.`, trip);
    }
    trip.status = "REJECTED";
    this.emit("dispatch.rejected", this.tripOut(trip));
    this.releaseBus(trip);
    this.failover(trip);
    return this.tripOut(trip);
  }

  listSurges(): Surge[] {
    this.sync();
    return this.listSurgesNoSync();
  }

  listBuses(): Bus[] {
    this.sync();
    return [...this.buses.values()].map((b) => this.busOut(b));
  }

  listTrips(): AdditionalTrip[] {
    this.sync();
    return [...this.trips.values()].map((t) => this.tripOut(t));
  }

  getTrip(tripId: string): AdditionalTrip | undefined {
    this.sync();
    const t = this.trips.get(tripId);
    return t ? this.tripOut(t) : undefined;
  }

  getTripDetail(tripId: string): AdditionalTripDetail | undefined {
    this.sync();
    const trip = this.trips.get(tripId);
    if (!trip) return undefined;
    const surge = this.surges.get(trip.surgeId);
    if (!surge) return undefined;
    const bus = this.buses.get(trip.tpl.busId);
    const loc = bus ? this.busPosition(bus, this.simMs).coord : trip.tpl.deadheadPath[0];
    const base = this.tripOut(trip);
    return {
      ...base,
      bus: { id: trip.tpl.busId, current_location: toLatLon(loc) },
      surge: this.surgeOut(surge),
      progress: { percent_complete: base.progress.percent_complete, ...this.stopProgress(trip) },
    };
  }

  subscribe(fn: (msg: WsMessage) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  step(wallNow: number = this.now()): void {
    this.sync(wallNow);
    if (this.status !== "RUNNING") return;
    this.emit("simulation.tick", this.tickData());

    const positions: BusPosition[] = [];
    for (const bus of this.buses.values()) {
      if (!this.isMoving(bus)) continue;
      const p = this.busPosition(bus, this.simMs);
      positions.push({ bus_id: bus.id, location: toLatLon(p.coord), heading_deg: p.heading, status: bus.status });
    }
    if (positions.length > 0) this.emit("bus.positions_updated", { positions });

    for (const trip of this.trips.values()) {
      if (trip.status !== "BUS_EN_ROUTE" && trip.status !== "IN_SERVICE") continue;
      const p = this.progress(trip);
      if (p === trip.lastProgressSent || wallNow - trip.lastProgressWall < PROGRESS_EVERY_MS) continue;
      trip.lastProgressWall = wallNow;
      trip.lastProgressSent = p;
      this.emit("trip.updated", this.tripOut(trip));
    }
  }

  dropConnections(): void {
    for (const fn of [...this.dropListeners]) fn();
  }

  onDropConnections(fn: () => void): () => void {
    this.dropListeners.add(fn);
    return () => {
      this.dropListeners.delete(fn);
    };
  }

  // ======================================================================
  // Clock and event processing
  // ======================================================================

  private reanchor(wall: number = this.now()) {
    this.anchorSim = this.simMs;
    this.anchorWall = wall;
  }

  /** Process every scheduled event up to the running target time. */
  private sync(wall: number = this.now()) {
    if (this.status !== "RUNNING") return;
    const target = Math.min(this.maxMs, this.anchorSim + Math.max(0, wall - this.anchorWall) * this.speed);
    if (target <= this.simMs && this.simMs < this.maxMs) return;
    this.processUntil(target);
    if (this.status === "RUNNING" && this.simMs >= this.maxMs) {
      this.simMs = this.maxMs;
      this.status = "PAUSED";
      this.emitClock("PAUSED");
    }
  }

  private processUntil(target: number) {
    // Skip hour boundaries we'd only flood the client with.
    while (target - this.nextHourMs > MAX_HOUR_CATCHUP * HOUR_MS) this.nextHourMs += HOUR_MS;
    for (;;) {
      const ev = this.queue[0];
      const evT = ev ? ev.t : Number.POSITIVE_INFINITY;
      const t = Math.min(evT, this.nextHourMs);
      if (t > target) break;
      this.simMs = Math.max(this.simMs, t);
      if (this.nextHourMs <= evT) {
        const boundary = this.nextHourMs;
        this.nextHourMs += HOUR_MS;
        for (const hub of SEED_HUB_IDS) this.emit("hub.demand_updated", this.hubStatus(hub, boundary));
        continue;
      }
      this.queue.shift();
      this.handle(ev);
      if (this.status !== "RUNNING") return; // auto-paused at this instant
    }
    this.simMs = Math.max(this.simMs, target);
  }

  private schedule(t: number, kind: EvKind, ref: string) {
    const ev: Ev = { t, n: this.evCounter++, kind, ref };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > t || (this.queue[i - 1].t === t && this.queue[i - 1].n > ev.n))) i--;
    this.queue.splice(i, 0, ev);
  }

  private handle(ev: Ev) {
    switch (ev.kind) {
      case "detect": {
        const def = getWorld().scenarios.find((s) => s.id === ev.ref);
        if (!def || this.surges.has(def.surgeId)) return;
        const surge = this.createScenarioSurge(def);
        this.surges.set(surge.id, surge);
        this.schedule(surge.windowStartMs, "windowStart", surge.id);
        this.schedule(surge.windowEndMs, "windowEnd", surge.id);
        const tpl = surge.templates[0];
        if (!tpl) {
          this.emit("surge.updated", this.surgeOut(surge));
          return;
        }
        const trip = this.proposeTrip(surge, tpl, ev.t, ev.t + PROPOSAL_TTL_MS);
        this.emit("surge.updated", this.surgeOut(surge));
        this.emitProposal(trip);
        return;
      }
      case "expire": {
        const trip = this.trips.get(ev.ref);
        if (!trip || trip.status !== "PROPOSED" || trip.expiresMs !== ev.t) return;
        trip.status = "EXPIRED";
        this.emit("trip.updated", this.tripOut(trip));
        this.releaseBus(trip);
        this.failover(trip);
        return;
      }
      case "dispatch": {
        const trip = this.trips.get(ev.ref);
        if (!trip || trip.status !== "APPROVED" || trip.dispatchMs !== ev.t) return;
        trip.status = "BUS_EN_ROUTE";
        this.markProgressSent(trip);
        this.emit("trip.updated", this.tripOut(trip));
        return;
      }
      case "arrive": {
        const trip = this.trips.get(ev.ref);
        if (!trip || trip.status !== "BUS_EN_ROUTE" || trip.arrivalMs !== ev.t) return;
        this.setBusStatus(trip.tpl.busId, "WAITING");
        return;
      }
      case "depart": {
        const trip = this.trips.get(ev.ref);
        if (!trip || trip.status !== "BUS_EN_ROUTE" || trip.departureMs !== ev.t) return;
        trip.status = "IN_SERVICE";
        this.markProgressSent(trip);
        this.emit("trip.updated", this.tripOut(trip));
        this.setBusStatus(trip.tpl.busId, "IN_SERVICE");
        return;
      }
      case "complete": {
        const trip = this.trips.get(ev.ref);
        if (!trip || trip.status !== "IN_SERVICE" || trip.completionMs !== ev.t) return;
        trip.status = "COMPLETED";
        this.markProgressSent(trip);
        this.emit("trip.updated", this.tripOut(trip));
        const bus = this.buses.get(trip.tpl.busId);
        if (bus) {
          const endMs = ev.t + trip.tpl.returnMin * MINUTE_MS;
          bus.status = "RETURNING";
          bus.returning = { path: trip.tpl.returnPath, startMs: ev.t, endMs };
          this.emit("bus.updated", this.busOut(bus));
          this.schedule(endMs, "home", bus.id);
        }
        return;
      }
      case "home": {
        const bus = this.buses.get(ev.ref);
        if (!bus || bus.status !== "RETURNING" || bus.returning?.endMs !== ev.t) return;
        bus.status = "AVAILABLE";
        bus.assignedTripId = null;
        bus.returning = null;
        this.emit("bus.updated", this.busOut(bus));
        return;
      }
      case "windowStart": {
        const surge = this.surges.get(ev.ref);
        if (!surge || surge.phase !== "UPCOMING") return;
        surge.phase = "ACTIVE";
        const trips = surge.tripIds.map((id) => this.trips.get(id)).filter((t): t is TripRec => !!t);
        if (!trips.some((t) => APPROVED_EVER.has(t.status))) {
          for (const trip of trips) {
            if (trip.status !== "PROPOSED") continue;
            trip.status = "EXPIRED";
            this.emit("trip.updated", this.tripOut(trip));
            this.releaseBus(trip);
          }
          // NO_BUS_AVAILABLE is kept: it says more than EXPIRED about why nothing was sent.
          if (surge.status === "PENDING" || surge.status === "AWAITING_APPROVAL") surge.status = "EXPIRED";
        }
        this.emit("surge.updated", this.surgeOut(surge));
        return;
      }
      case "windowEnd": {
        const surge = this.surges.get(ev.ref);
        if (!surge || surge.phase === "RESOLVED") return;
        surge.phase = "RESOLVED";
        surge.actual = surge.resolve();
        this.emit("surge.updated", this.surgeOut(surge));
        return;
      }
    }
  }

  // ======================================================================
  // Proposals, failover, buses
  // ======================================================================

  private proposeTrip(surge: SurgeRec, tpl: TripTemplate, t: number, expiresMs: number): TripRec {
    const trip: TripRec = {
      tpl,
      surgeId: surge.id,
      hubId: surge.hubId,
      status: "PROPOSED",
      proposedMs: t,
      expiresMs: Math.min(expiresMs, surge.windowStartMs),
      dispatchMs: tpl.dispatchMs,
      arrivalMs: tpl.arrivalMs,
      departureMs: tpl.departureMs,
      completionMs: tpl.completionMs,
      windowStartMs: surge.windowStartMs,
      lastProgressWall: Number.NEGATIVE_INFINITY,
      lastProgressSent: 0,
    };
    if (t > trip.dispatchMs) this.retime(trip, t);
    this.trips.set(tpl.id, trip);
    if (!surge.tripIds.includes(tpl.id)) surge.tripIds.push(tpl.id);
    surge.status = "AWAITING_APPROVAL";
    const bus = this.buses.get(tpl.busId);
    if (bus) {
      bus.status = "RESERVED";
      bus.proposedTripId = tpl.id;
      bus.assignedTripId = null;
      bus.returning = null;
    }
    this.schedule(trip.expiresMs, "expire", tpl.id);
    return trip;
  }

  /** dispatch.proposed + bus.updated, then the server-side auto-pause at this instant (message.txt §11b). */
  private emitProposal(trip: TripRec) {
    this.emit("dispatch.proposed", this.tripOut(trip));
    const bus = this.buses.get(trip.tpl.busId);
    if (bus) this.emit("bus.updated", this.busOut(bus));
    if (this.status === "RUNNING" && this.autoPause) {
      this.status = "PAUSED";
      this.reanchor();
      this.emitClock("AUTO_PAUSE_PROPOSAL");
    }
  }

  /** After a rejection or expiry: propose the next alternative, else NO_BUS_AVAILABLE. */
  private failover(failed: TripRec) {
    const surge = this.surges.get(failed.surgeId);
    if (!surge) return;
    const idx = surge.templates.findIndex((t) => t.id === failed.tpl.id);
    const next = idx >= 0 ? surge.templates[idx + 1] : undefined;
    const t = this.simMs;
    if (next && !this.trips.has(next.id) && t < surge.windowStartMs) {
      const trip = this.proposeTrip(surge, next, t, t + PROPOSAL_TTL_MS);
      this.emit("surge.updated", this.surgeOut(surge));
      this.emitProposal(trip);
      return;
    }
    const pending = surge.tripIds.some((id) => {
      const s = this.trips.get(id)?.status;
      return s !== undefined && (s === "PROPOSED" || APPROVED_EVER.has(s));
    });
    if (!pending && surge.phase === "UPCOMING") surge.status = "NO_BUS_AVAILABLE";
    this.emit("surge.updated", this.surgeOut(surge));
  }

  /** Shift a late approval: the bus leaves now and runs the same legs (departure never moves earlier). */
  private retime(trip: TripRec, dispatchMs: number) {
    const tpl = trip.tpl;
    trip.dispatchMs = dispatchMs;
    trip.arrivalMs = dispatchMs + tpl.deadheadMin * MINUTE_MS;
    trip.departureMs = Math.max(tpl.departureMs, trip.arrivalMs + 5 * MINUTE_MS);
    trip.completionMs = trip.departureMs + tpl.serviceMin * MINUTE_MS;
  }

  /** Rejected / expired while PROPOSED: the bus never moved, so it's AVAILABLE again. */
  private releaseBus(trip: TripRec) {
    const bus = this.buses.get(trip.tpl.busId);
    if (!bus || bus.proposedTripId !== trip.tpl.id) return;
    bus.proposedTripId = null;
    if (bus.assignedTripId === null && bus.status === "RESERVED") bus.status = "AVAILABLE";
    this.emit("bus.updated", this.busOut(bus));
  }

  private setBusStatus(busId: string, status: BusStatus) {
    const bus = this.buses.get(busId);
    if (!bus || bus.status === status) return;
    bus.status = status;
    this.emit("bus.updated", this.busOut(bus));
  }

  private markProgressSent(trip: TripRec) {
    trip.lastProgressSent = this.progress(trip);
    trip.lastProgressWall = this.now();
  }

  // ======================================================================
  // Rebuild (startup and seek, message.txt §8b)
  // ======================================================================

  private rebuild(t: number) {
    this.simMs = t;
    this.nextHourMs = startOfVancouverHour(t) + HOUR_MS;
    this.surges.clear();
    this.trips.clear();
    this.buses.clear();
    this.queue = [];
    this.evCounter = 0;

    const world = getWorld();
    for (const def of world.fleet) {
      this.buses.set(def.id, {
        def,
        looper: null,
        id: def.id,
        source: def.source,
        status: "AVAILABLE",
        assignedTripId: null,
        proposedTripId: null,
        returning: null,
      });
    }
    for (const l of this.loopers) {
      this.buses.set(l.id, {
        def: null,
        looper: l,
        id: l.id,
        source: {
          type: "ROUTE",
          route: {
            route_id: l.route.route_id,
            line_key: l.route.line_key,
            short_name: l.route.short_name,
            long_name: l.route.long_name,
            mode: l.route.mode,
            color: l.route.color,
            text_color: l.route.text_color,
          },
          depot_name: null,
        },
        status: "REPOSITIONING",
        assignedTripId: null,
        proposedTripId: null,
        returning: null,
      });
    }

    for (const def of world.scenarios) {
      const detectedMs = def.detectedMs;
      if (t <= detectedMs) {
        this.schedule(detectedMs, "detect", def.id);
        continue;
      }
      if (t >= def.windowEndMs) continue;
      const surge = this.createScenarioSurge(def);
      this.surges.set(surge.id, surge);
      this.schedule(surge.windowEndMs, "windowEnd", surge.id);
      const tpl = surge.templates[0];
      if (t < def.windowStartMs) {
        surge.phase = "UPCOMING";
        this.schedule(surge.windowStartMs, "windowStart", surge.id);
        if (tpl) {
          // Earlier decisions are discarded: the first proposal comes back with a fresh approval window.
          const trip = this.proposeTrip(surge, tpl, detectedMs, t + PROPOSAL_TTL_MS);
          if (t > trip.dispatchMs) this.retime(trip, t);
        }
      } else {
        surge.phase = "ACTIVE";
        surge.status = "EXPIRED";
        if (tpl) {
          const trip = this.proposeTrip(surge, tpl, detectedMs, surge.windowStartMs);
          trip.status = "EXPIRED";
          const bus = this.buses.get(tpl.busId);
          if (bus) {
            bus.status = "AVAILABLE";
            bus.proposedTripId = null;
          }
          surge.status = "EXPIRED";
        }
      }
    }

    if (this.nonHub) {
      const surge = this.createNonHubSurge(t);
      this.surges.set(surge.id, surge);
      this.schedule(surge.windowStartMs, "windowStart", surge.id);
      this.schedule(surge.windowEndMs, "windowEnd", surge.id);
    }
  }

  private createScenarioSurge(def: ScenarioDef): SurgeRec {
    const hubId = def.hubId ?? "";
    const typical = this.synth.typicalPings(hubId, def.localDate, def.peakPredictedHour);
    const predicted = Math.round(typical * def.predictedIndex);
    const leadH = def.peakPredictedHour - def.timeline.detectedHour;
    const half = 0.08 + 0.01 * leadH;
    const destinations: PredictedDestination[] = def.destinations.map((d) => ({
      origin: d.origin,
      location: d.location ? { ...d.location } : null,
      share_pct: d.share_pct,
      expected_pings: Math.round((predicted * d.share_pct) / 100),
    }));
    return {
      id: def.surgeId,
      hubId: def.hubId,
      locationName: def.locationName,
      location: { ...def.location },
      localDate: def.localDate,
      detectedMs: def.detectedMs,
      windowStartMs: def.windowStartMs,
      windowEndMs: def.windowEndMs,
      magnitude: {
        predicted_pings: predicted,
        typical_pings: typical,
        surge_index: def.predictedIndex,
        lower_80: Math.round(predicted * (1 - half)),
        upper_80: Math.round(predicted * (1 + half)),
      },
      severity: def.severity,
      drivers: def.drivers.map((d) => ({ ...d })),
      destinations,
      templates: def.trips,
      resolve: () => ({
        pings: this.synth.actualPings(hubId, def.localDate, def.peakActualHour),
        surge_index: def.actualIndexMax,
      }),
      status: "PENDING",
      phase: "UPCOMING",
      tripIds: [],
      actual: null,
    };
  }

  /** Dev-only surge away from the hubs (hub_id null, no proposals), 2–4 h after the (seek) time. */
  private createNonHubSurge(t: number): SurgeRec {
    const detectedMs = startOfVancouverHour(t);
    const p = vancouverParts(detectedMs);
    const typical = 1400;
    const index = 1.55;
    const predicted = Math.round(typical * index);
    const half = 0.08 + 0.01 * 2;
    return {
      id: `surge-nonhub-${p.local_date}-${String(p.hour).padStart(2, "0")}`,
      hubId: null,
      locationName: NONHUB_NAME,
      location: { ...NONHUB_LOCATION },
      localDate: p.local_date,
      detectedMs,
      windowStartMs: detectedMs + 2 * HOUR_MS,
      windowEndMs: detectedMs + 4 * HOUR_MS,
      magnitude: {
        predicted_pings: predicted,
        typical_pings: typical,
        surge_index: index,
        lower_80: Math.round(predicted * (1 - half)),
        upper_80: Math.round(predicted * (1 + half)),
      },
      severity: severityFor(index),
      drivers: [],
      destinations: [],
      templates: [],
      resolve: () => ({ pings: Math.round(predicted * 1.04), surge_index: Math.round(index * 1.04 * 100) / 100 }),
      status: "PENDING",
      phase: "UPCOMING",
      tripIds: [],
      actual: null,
    };
  }

  // ======================================================================
  // Output (contract-exact objects)
  // ======================================================================

  private clock(): Clock {
    const p = vancouverParts(this.simMs);
    return {
      current_time: toVancouverIso(this.simMs),
      local_date: p.local_date,
      hour: p.hour,
      speed: this.speed,
      status: this.status,
      min_time: MIN_TIME,
      max_time: MAX_TIME,
      approval_mode: "MANUAL",
      auto_pause_on_proposal: this.autoPause,
      epoch: this.epoch,
    };
  }

  private tickData() {
    const p = vancouverParts(this.simMs);
    return { current_time: toVancouverIso(this.simMs), local_date: p.local_date, hour: p.hour };
  }

  private listSurgesNoSync(): Surge[] {
    return [...this.surges.values()].sort((a, b) => a.windowStartMs - b.windowStartMs).map((s) => this.surgeOut(s));
  }

  private surgeOut(s: SurgeRec): Surge {
    return {
      id: s.id,
      hub_id: s.hubId,
      location_name: s.locationName,
      location: { ...s.location },
      detected_at: toVancouverIso(s.detectedMs),
      predicted_window: { start: toVancouverIso(s.windowStartMs), end: toVancouverIso(s.windowEndMs) },
      lead_time_minutes: Math.round((s.windowStartMs - s.detectedMs) / MINUTE_MS),
      magnitude: { ...s.magnitude },
      severity: s.severity,
      drivers: s.drivers.map((d) => ({ ...d })),
      predicted_destinations: s.destinations.map((d) => ({ ...d, location: d.location ? { ...d.location } : null })),
      status: s.status,
      phase: s.phase,
      additional_trip_ids: [...s.tripIds],
      actual: s.actual ? { ...s.actual } : null,
    };
  }

  private progress(trip: TripRec): number {
    switch (trip.status) {
      case "BUS_EN_ROUTE":
      case "IN_SERVICE":
        return round3(frac(this.simMs, trip.dispatchMs, trip.completionMs));
      case "COMPLETED":
        return 1;
      default:
        return 0;
    }
  }

  private stopProgress(trip: TripRec): { current_stop_id: string | null; next_stop_id: string | null } {
    const stops = trip.tpl.serviceStops;
    if (stops.length === 0) return { current_stop_id: null, next_stop_id: null };
    switch (trip.status) {
      case "PROPOSED":
      case "APPROVED":
      case "BUS_EN_ROUTE":
        return { current_stop_id: null, next_stop_id: stops[0].id };
      case "IN_SERVICE": {
        const total = stops[stops.length - 1].km;
        const km = total * frac(this.simMs, trip.departureMs, trip.completionMs);
        let cur = 0;
        for (let i = 0; i < stops.length; i++) if (stops[i].km <= km + 1e-9) cur = i;
        return { current_stop_id: stops[cur].id, next_stop_id: stops[cur + 1]?.id ?? null };
      }
      case "COMPLETED":
        return { current_stop_id: stops[stops.length - 1].id, next_stop_id: null };
      default:
        return { current_stop_id: null, next_stop_id: null };
    }
  }

  private tripOut(trip: TripRec): AdditionalTrip {
    const tpl = trip.tpl;
    const surge = this.surges.get(trip.surgeId);
    return {
      id: tpl.id,
      surge_id: trip.surgeId,
      hub_id: trip.hubId,
      bus: { id: tpl.busId },
      route: { ...tpl.route },
      donor_route: tpl.donor ? { ...tpl.donor } : null,
      status: trip.status,
      proposed_at: toVancouverIso(trip.proposedMs),
      approval_expires_at: toVancouverIso(trip.expiresMs),
      dispatch_time: toVancouverIso(trip.dispatchMs),
      arrival_at_surge_time: toVancouverIso(trip.arrivalMs),
      arrives_before_surge: trip.arrivalMs <= trip.windowStartMs,
      departure_time: toVancouverIso(trip.departureMs),
      estimated_completion_time: toVancouverIso(trip.completionMs),
      surge_location: { ...tpl.surgeLocation },
      predicted_destinations: surge ? surge.destinations.map((d) => ({ ...d, location: d.location ? { ...d.location } : null })) : [],
      deadhead_path: lineString(tpl.deadheadPath),
      service_path: lineString(tpl.servicePath),
      impact: { added_capacity: BUS_CAPACITY, deadhead_minutes: tpl.deadheadMin, deadhead_km: tpl.deadheadKm },
      rationale: tpl.rationale,
      evidence: tpl.evidence.map((e) => ({ ...e })),
      replaces_trip_id: tpl.replacesTripId,
      progress: { percent_complete: this.progress(trip) },
    };
  }

  private isMoving(bus: BusRec): boolean {
    if (bus.looper) return true;
    if (bus.status === "IN_SERVICE" || bus.status === "RETURNING") return true;
    if (bus.status === "DEADHEADING") {
      const trip = bus.assignedTripId ? this.trips.get(bus.assignedTripId) : undefined;
      return !!trip && this.simMs >= trip.dispatchMs;
    }
    return false;
  }

  private busPosition(bus: BusRec, t: number): { coord: Coord; heading: number } {
    if (bus.looper) return looperPosition(bus.looper, t);
    if (bus.status === "RETURNING" && bus.returning) {
      const p = pointAtFraction(bus.returning.path, frac(t, bus.returning.startMs, bus.returning.endMs));
      return { coord: p.coord, heading: p.heading };
    }
    const trip = bus.assignedTripId ? this.trips.get(bus.assignedTripId) : undefined;
    if (trip) {
      if (bus.status === "DEADHEADING") {
        const p = pointAtFraction(trip.tpl.deadheadPath, frac(t, trip.dispatchMs, trip.arrivalMs));
        return { coord: p.coord, heading: p.heading };
      }
      if (bus.status === "WAITING") {
        const p = pointAtFraction(trip.tpl.deadheadPath, 1);
        return { coord: p.coord, heading: p.heading };
      }
      if (bus.status === "IN_SERVICE") {
        const p = pointAtFraction(trip.tpl.servicePath, frac(t, trip.departureMs, trip.completionMs));
        return { coord: p.coord, heading: p.heading };
      }
    }
    const def = bus.def;
    return def ? { coord: def.home, heading: def.heading } : { coord: [0, 0], heading: 0 };
  }

  private busOut(bus: BusRec): Bus {
    const p = this.busPosition(bus, this.simMs);
    return {
      id: bus.id,
      status: bus.status,
      location: toLatLon(p.coord),
      heading_deg: p.heading,
      capacity: BUS_CAPACITY,
      source: {
        type: bus.source.type,
        route: bus.source.route ? { ...bus.source.route } : null,
        depot_name: bus.source.depot_name,
      },
      assigned_trip_id: bus.assignedTripId,
      proposed_trip_id: bus.proposedTripId,
    };
  }

  private hubStatus(hubId: string, t: number): HubStatus {
    let next: HubStatus["next_surge"] = null;
    let active = 0;
    let pending = 0;
    for (const s of this.surges.values()) {
      if (s.hubId !== hubId || s.phase === "RESOLVED") continue;
      if (!next || s.windowStartMs < isoToMs(next.window_start)) {
        next = {
          surge_id: s.id,
          window_start: toVancouverIso(s.windowStartMs),
          surge_index: s.magnitude.surge_index,
          severity: s.severity,
        };
      }
    }
    for (const trip of this.trips.values()) {
      if (trip.hubId !== hubId) continue;
      if (ACTIVE_TRIP.has(trip.status)) active++;
      if (trip.status === "PROPOSED") pending++;
    }
    return this.synth.hubStatusAt(hubId, t, { next_surge: next, active_trip_count: active, pending_proposal_count: pending });
  }

  // ======================================================================
  // Emission and errors
  // ======================================================================

  private emit<T extends WsMessage["type"]>(type: T, data: Extract<WsMessage, { type: T }>["data"]) {
    this.seq += 1;
    const msg = { type, seq: this.seq, epoch: this.epoch, simulation_time: toVancouverIso(this.simMs), data } as WsMessage;
    for (const fn of [...this.subscribers]) {
      try {
        fn(msg);
      } catch (err) {
        console.error("MockSim subscriber failed", err);
      }
    }
  }

  private emitClock(reason: StateChangedReason) {
    this.emit("simulation.state_changed", { ...this.clock(), reason });
  }

  private mustTrip(tripId: string): TripRec {
    const trip = this.trips.get(tripId);
    if (!trip) throw new MockApiError(404, "TRIP_NOT_FOUND", `No trip ${tripId}.`);
    return trip;
  }

  private checkEpoch(trip: TripRec, epoch: number) {
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) {
      throw new MockApiError(400, "BAD_REQUEST", "Body must include the current epoch.");
    }
    if (epoch < this.epoch) {
      throw this.conflict("STALE_EPOCH", `The simulation moved (epoch ${this.epoch}); refetch /state.`, trip);
    }
  }

  private conflict(code: string, message: string, trip: TripRec): MockApiError {
    return new MockApiError(409, code, message, this.tripOut(trip));
  }
}

function hhmm(ms: number): string {
  const p = vancouverParts(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
