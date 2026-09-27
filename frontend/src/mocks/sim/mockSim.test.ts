// MockSim state machine (spec §18.1). Most tests use a simple deterministic fake synth so they only exercise
// the simulator; the last block runs the demo story against the real synthesis.
import { describe, expect, it, vi } from "vitest";
import {
  LegacyStateResponse as StateResponse,
  LegacyWsMessage as WsMessage,
  type LegacyAdditionalTrip as AdditionalTrip,
  type BusStatus,
  type LegacyWsMessageOf as WsMessageOf,
} from "@/lib/api/schemas";
import { MockSim } from "./mockSim";
import { getWorld } from "./scenarios";
import { MockApiError, type SynthApi } from "./types";

vi.mock("./synth", async () => {
  const { toVancouverIso, vancouverParts, startOfVancouverHour, HOUR_MS } = await import("@/lib/time");
  const fake: SynthApi = {
    dayTypeFor: () => "sat",
    actualPings: (_hub, _date, hour) => 4000 + hour * 10,
    typicalPings: () => 2610,
    forecastFor: () => ({ forecast: 2610, lower_80: 2400, upper_80: 2800 }),
    hubStatusAt: (hubId, simMs, extra) => {
      const cur = vancouverParts(simMs);
      const prev = vancouverParts(startOfVancouverHour(simMs) - HOUR_MS);
      return {
        hub_id: hubId,
        as_of: toVancouverIso(simMs),
        current_hour: { local_date: cur.local_date, hour: cur.hour, pings_so_far: 100, typical_pings_so_far: 90, complete: false },
        last_full_hour: {
          local_date: prev.local_date,
          hour: prev.hour,
          pings: 2000,
          typical_pings: 1900,
          surge_index: 1.05,
          is_surge: false,
        },
        ...extra,
      };
    },
  };
  return { synth: fake };
});

const UBC_A = "trip-ubc-2025-12-06-a";
const UBC_B = "trip-ubc-2025-12-06-b";
const UBC_SURGE = "surge-ubc-2025-12-06";
const iso = (hhmm: string) => `2025-12-06T${hhmm}:00-08:00`;

function harness(opts: ConstructorParameters<typeof MockSim>[0] = {}) {
  let wall = 1_700_000_000_000;
  const sim = new MockSim({ now: () => wall, ...opts });
  const msgs: WsMessage[] = [];
  sim.subscribe((m) => msgs.push(m));
  const tick = (ms = 250) => {
    wall += ms;
    sim.step(wall);
  };
  /** Steps 250 ms at a time until `done()` (or fails after `max` steps). */
  const runUntil = (done: () => boolean, max = 5000) => {
    for (let i = 0; i < max; i++) {
      if (done()) return;
      tick();
    }
    throw new Error(`runUntil gave up at ${sim.getClock().current_time}`);
  };
  const trip = (id: string) => sim.getTrip(id) as AdditionalTrip;
  const bus = (id: string) => sim.listBuses().find((b) => b.id === id);
  const of = <T extends WsMessage["type"]>(type: T) => msgs.filter((m): m is WsMessageOf<T> => m.type === type);
  return { sim, msgs, tick, runUntil, trip, bus, of, wallNow: () => wall };
}

/** Seek to UBC 09:00, 300x, play until the auto-pause at the proposal. */
function toUbcProposal(h: ReturnType<typeof harness>) {
  h.sim.seek(iso("09:00"));
  h.sim.setSpeed(300);
  h.sim.resume();
  h.runUntil(() => h.sim.getClock().status === "PAUSED");
}

function expectApiError(fn: () => unknown, status: number, code: string): MockApiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MockApiError);
    const e = err as MockApiError;
    expect(e.code).toBe(code);
    expect(e.status).toBe(status);
    return e;
  }
  throw new Error(`expected ${code}`);
}

function comparable(state: StateResponse) {
  return { ...state, epoch: 0, last_seq: 0, simulation: { ...state.simulation, epoch: 0 } };
}

describe("MockSim clock", () => {
  it("starts paused at the default start time with the contract defaults", () => {
    const { sim } = harness();
    const c = sim.getClock();
    expect(c).toMatchObject({
      current_time: "2026-02-11T13:00:00-08:00",
      status: "PAUSED",
      speed: 60,
      auto_pause_on_proposal: true,
      approval_mode: "MANUAL",
      epoch: 1,
      min_time: "2025-11-15T00:00:00-08:00",
      max_time: "2026-08-31T23:00:00-07:00",
    });
  });

  it("rejects invalid speeds and out-of-range seeks with 400s", () => {
    const { sim } = harness();
    expectApiError(() => sim.setSpeed(120), 400, "INVALID_SPEED");
    expectApiError(() => sim.seek("2025-11-14T23:00:00-08:00"), 400, "OUT_OF_RANGE");
    expectApiError(() => sim.seek("2026-09-01T00:00:00-07:00"), 400, "OUT_OF_RANGE");
    for (const s of [1, 60, 300, 900, 3600]) expect(sim.setSpeed(s).speed).toBe(s);
  });

  it("advances sim time by wall time × speed and ticks once per step", () => {
    const h = harness();
    h.sim.setSpeed(3600);
    h.sim.resume();
    h.tick(250);
    expect(h.sim.getClock().current_time).toBe("2026-02-11T13:15:00-08:00");
    expect(h.of("simulation.tick")).toHaveLength(1);
    h.sim.pause();
    h.tick(10_000);
    expect(h.sim.getClock().current_time).toBe("2026-02-11T13:15:00-08:00");
    expect(h.of("simulation.tick")).toHaveLength(1);
  });

  it("emits hub.demand_updated for each hub at an hour boundary", () => {
    const h = harness();
    h.sim.setSpeed(3600);
    h.sim.resume();
    h.tick(1000); // 13:00 → 14:00
    const demand = h.of("hub.demand_updated");
    expect(demand.map((m) => m.data.hub_id).sort()).toEqual(["park-royal", "ubc", "waterfront"]);
    expect(demand.every((m) => m.simulation_time === "2026-02-11T14:00:00-08:00")).toBe(true);
  });
});

describe("MockSim seek", () => {
  it("is deterministic: the same T gives the same state apart from epoch and seq", () => {
    const h = harness();
    const t = iso("11:00");
    h.sim.seek(t);
    const first = h.sim.getState();
    h.sim.approve(UBC_A, first.epoch);
    h.sim.setSpeed(900);
    h.sim.resume();
    h.tick(2000);
    h.sim.pause();
    h.sim.setSpeed(60);
    h.sim.seek(t);
    const second = h.sim.getState();
    expect(second.epoch).toBe(first.epoch + 1);
    expect(comparable(second)).toEqual(comparable(first));
    const fresh = harness();
    fresh.sim.seek(t);
    expect(comparable(fresh.sim.getState())).toEqual(comparable(first));
  });

  it("rebuilds an open proposal as PROPOSED with a fresh approval window and emits state.reset", () => {
    const h = harness();
    const clock = h.sim.seek(iso("11:00"));
    expect(clock.epoch).toBe(2);
    expect(h.of("state.reset").at(-1)?.data).toEqual({ epoch: 2, reason: "SEEK" });
    const s = h.sim.getState();
    expect(s.surges).toHaveLength(1);
    expect(s.surges[0]).toMatchObject({ id: UBC_SURGE, status: "AWAITING_APPROVAL", phase: "UPCOMING", additional_trip_ids: [UBC_A] });
    expect(h.trip(UBC_A)).toMatchObject({ status: "PROPOSED", proposed_at: iso("10:00"), approval_expires_at: iso("11:45") });
    expect(h.bus("bus-1")?.status).toBe("RESERVED");
    expect(s.buses.filter((b) => b.status !== "AVAILABLE").map((b) => b.id)).toEqual(["bus-1"]);
  });

  it("keeps status and speed, never auto-pauses, and drops surges whose window has ended", () => {
    const h = harness();
    h.sim.setSpeed(300);
    h.sim.resume();
    h.sim.seek(iso("12:00"));
    expect(h.sim.getClock()).toMatchObject({ status: "RUNNING", speed: 300 });
    h.sim.seek(iso("15:00"));
    expect(h.sim.listSurges()).toHaveLength(0);
    h.sim.seek(iso("14:00"));
    expect(h.sim.listSurges()[0]).toMatchObject({ phase: "ACTIVE", status: "EXPIRED" });
    expect(h.trip(UBC_A).status).toBe("EXPIRED");
  });
});

describe("UBC exam weekend story", () => {
  it("detects the surge at 10:00 with proposal A and auto-pauses exactly then", () => {
    const h = harness();
    toUbcProposal(h);
    const clock = h.sim.getClock();
    expect(clock.current_time).toBe(iso("10:00"));
    expect(clock.status).toBe("PAUSED");

    const surgeMsg = h.of("surge.updated").find((m) => m.data.id === UBC_SURGE);
    expect(surgeMsg?.simulation_time).toBe(iso("10:00"));
    expect(surgeMsg?.data).toMatchObject({
      hub_id: "ubc",
      location_name: "UBC Exchange",
      detected_at: iso("10:00"),
      predicted_window: { start: iso("13:00"), end: iso("15:00") },
      lead_time_minutes: 180,
      severity: "HIGH",
      status: "AWAITING_APPROVAL",
      phase: "UPCOMING",
      actual: null,
    });
    expect(surgeMsg?.data.magnitude.surge_index).toBe(1.79);
    expect(surgeMsg?.data.drivers[0]).toMatchObject({ type: "EXAM", label: "UBC December exam period" });
    expect(surgeMsg?.data.predicted_destinations.map((d) => [d.origin, d.share_pct])).toEqual([
      ["Surrey", 14.5],
      ["Richmond", 11.6],
      ["New Westminster", 6.3],
      ["North Vancouver", 5.6],
    ]);

    const proposedIdx = h.msgs.findIndex((m) => m.type === "dispatch.proposed");
    const pauseIdx = h.msgs.findIndex(
      (m) => m.type === "simulation.state_changed" && m.data.reason === "AUTO_PAUSE_PROPOSAL",
    );
    expect(proposedIdx).toBeGreaterThan(-1);
    expect(pauseIdx).toBeGreaterThan(proposedIdx);
    const pause = h.msgs[pauseIdx] as WsMessageOf<"simulation.state_changed">;
    expect(pause.data).toMatchObject({ status: "PAUSED", current_time: iso("10:00") });

    const a = (h.msgs[proposedIdx] as WsMessageOf<"dispatch.proposed">).data;
    expect(a).toMatchObject({
      id: UBC_A,
      status: "PROPOSED",
      bus: { id: "bus-1" },
      route: { line_key: "99", load_before_pct: 104, load_after_pct: 91 },
      donor_route: { line_key: "25", load_before_pct: 48, load_after_pct: 55 },
      proposed_at: iso("10:00"),
      approval_expires_at: iso("10:45"),
      dispatch_time: iso("12:20"),
      arrival_at_surge_time: iso("12:40"),
      departure_time: iso("12:55"),
      estimated_completion_time: iso("13:45"),
      arrives_before_surge: true,
      impact: { added_capacity: 77, deadhead_minutes: 20, deadhead_km: 11.4 },
      replaces_trip_id: null,
    });
    expect(a.evidence.length).toBeGreaterThanOrEqual(3);
    expect(a.evidence.every((e) => e.source.length > 0)).toBe(true);
    // Deadhead ends where the service begins; the service runs east along Broadway.
    const dh = a.deadhead_path.coordinates;
    const sv = a.service_path.coordinates;
    expect(dh.at(-1)).toEqual(sv[0]);
    expect(sv.at(-1)?.[0]).toBeGreaterThan(sv[0][0] + 0.15);
    expect(h.bus("bus-1")).toMatchObject({ status: "RESERVED", proposed_trip_id: UBC_A, assigned_trip_id: null });
  });

  it("approve → APPROVED → BUS_EN_ROUTE → IN_SERVICE → COMPLETED with the bus statuses per the table", () => {
    const h = harness();
    toUbcProposal(h);
    const epoch = h.sim.getClock().epoch;
    const approved = h.sim.approve(UBC_A, epoch);
    expect(approved.status).toBe("APPROVED");
    expect(h.of("dispatch.approved").map((m) => m.data.id)).toEqual([UBC_A]);
    expect(h.bus("bus-1")).toMatchObject({ status: "DEADHEADING", assigned_trip_id: UBC_A, proposed_trip_id: null });
    expect(h.sim.listSurges()[0].status).toBe("DISPATCHED");
    // Double-click safe.
    expect(h.sim.approve(UBC_A, epoch).status).toBe("APPROVED");
    expect(h.of("dispatch.approved")).toHaveLength(1);

    h.sim.setSpeed(900);
    h.sim.resume();
    const busStatuses: BusStatus[] = [];
    const tripStatuses: string[] = [];
    let moved = 0;
    h.runUntil(() => h.bus("bus-1")?.status === "AVAILABLE" && h.trip(UBC_A).status === "COMPLETED");
    for (const m of h.msgs) {
      if (m.type === "bus.updated" && m.data.id === "bus-1") busStatuses.push(m.data.status);
      if ((m.type === "trip.updated" || m.type.startsWith("dispatch.")) && "id" in (m.data as object)) {
        const t = m.data as AdditionalTrip;
        if (t.id === UBC_A && tripStatuses.at(-1) !== t.status) tripStatuses.push(t.status);
      }
      if (m.type === "bus.positions_updated" && m.data.positions.some((p) => p.bus_id === "bus-1")) moved++;
    }
    expect(tripStatuses).toEqual(["PROPOSED", "APPROVED", "BUS_EN_ROUTE", "IN_SERVICE", "COMPLETED"]);
    expect(busStatuses).toEqual(["RESERVED", "DEADHEADING", "WAITING", "IN_SERVICE", "RETURNING", "AVAILABLE"]);
    expect(moved).toBeGreaterThan(10);

    const tripMsg = (status: string) => h.of("trip.updated").find((m) => m.data.id === UBC_A && m.data.status === status);
    expect(tripMsg("BUS_EN_ROUTE")?.simulation_time).toBe(iso("12:20"));
    expect(tripMsg("IN_SERVICE")?.simulation_time).toBe(iso("12:55"));
    expect(tripMsg("COMPLETED")?.simulation_time).toBe(iso("13:45"));
    expect(tripMsg("COMPLETED")?.data.progress.percent_complete).toBe(1);
    const waiting = h.of("bus.updated").find((m) => m.data.id === "bus-1" && m.data.status === "WAITING");
    expect(waiting?.simulation_time).toBe(iso("12:40"));
    const home = h.of("bus.updated").find((m) => m.data.id === "bus-1" && m.data.status === "AVAILABLE");
    expect(home?.simulation_time).toBe(iso("14:10"));
    // Back at its parking spot on route 25.
    const parked = getWorld().fleet.find((b) => b.id === "bus-1");
    expect(home?.data.location.lon).toBeCloseTo(parked?.home[0] ?? 0, 4);
    // Progress between phase changes, at most once per wall second per trip.
    const progress = h.of("trip.updated").filter((m) => m.data.id === UBC_A && m.data.status === "IN_SERVICE");
    expect(progress.length).toBeGreaterThan(1);
  });

  it("goes ACTIVE at 13:00 and RESOLVED at 15:00 with actual 1.88", () => {
    const h = harness();
    toUbcProposal(h);
    h.sim.approve(UBC_A, h.sim.getClock().epoch);
    h.sim.setSpeed(3600);
    h.sim.resume();
    h.runUntil(() => h.sim.listSurges()[0]?.phase === "RESOLVED");
    const updates = h.of("surge.updated").filter((m) => m.data.id === UBC_SURGE);
    const active = updates.find((m) => m.data.phase === "ACTIVE");
    const resolved = updates.find((m) => m.data.phase === "RESOLVED");
    expect(active?.simulation_time).toBe(iso("13:00"));
    expect(active?.data.status).toBe("DISPATCHED");
    expect(resolved?.simulation_time).toBe(iso("15:00"));
    expect(resolved?.data.actual?.surge_index).toBe(1.88);
    expect(resolved?.data.actual?.pings).toBe(4000 + 14 * 10); // the fake synth's pings at the peak actual hour (14:00)
  });

  it("reject A → alternative B carrying replaces_trip_id; reject B → NO_BUS_AVAILABLE", () => {
    const h = harness();
    toUbcProposal(h);
    const epoch = h.sim.getClock().epoch;
    const rejected = h.sim.reject(UBC_A, epoch, "Driver shortage on route 25");
    expect(rejected.status).toBe("REJECTED");
    const b = h.trip(UBC_B);
    expect(b).toMatchObject({
      status: "PROPOSED",
      replaces_trip_id: UBC_A,
      route: { line_key: "R4" },
      donor_route: { line_key: "14" },
      proposed_at: iso("10:00"),
      approval_expires_at: iso("10:45"),
      bus: { id: "bus-2" },
      arrives_before_surge: true,
    });
    expect(h.bus("bus-1")?.status).toBe("AVAILABLE");
    expect(h.bus("bus-2")?.status).toBe("RESERVED");
    expect(h.sim.listSurges()[0]).toMatchObject({ status: "AWAITING_APPROVAL", additional_trip_ids: [UBC_A, UBC_B] });
    const order = h.msgs.map((m) => m.type);
    expect(order.lastIndexOf("dispatch.rejected")).toBeLessThan(order.lastIndexOf("dispatch.proposed"));

    h.sim.reject(UBC_B, epoch);
    expect(h.sim.listSurges()[0].status).toBe("NO_BUS_AVAILABLE");
    expect(h.bus("bus-2")?.status).toBe("AVAILABLE");
  });

  it("A expiring with auto-pause off → EXPIRED and B proposed at that instant", () => {
    const h = harness();
    h.sim.seek(iso("09:00"));
    h.sim.setSettings({ auto_pause_on_proposal: false });
    h.sim.setSpeed(300);
    h.sim.resume();
    h.runUntil(() => h.sim.getTrip(UBC_B) !== undefined);
    expect(h.sim.getClock().status).toBe("RUNNING");
    const expired = h.of("trip.updated").find((m) => m.data.id === UBC_A && m.data.status === "EXPIRED");
    expect(expired?.simulation_time).toBe(iso("10:45"));
    expect(h.trip(UBC_A).status).toBe("EXPIRED");
    expect(h.trip(UBC_B)).toMatchObject({
      status: "PROPOSED",
      replaces_trip_id: UBC_A,
      proposed_at: iso("10:45"),
      approval_expires_at: iso("11:30"),
    });
    expect(h.bus("bus-1")?.status).toBe("AVAILABLE");
    expect(h.of("simulation.state_changed").some((m) => m.data.reason === "AUTO_PAUSE_PROPOSAL")).toBe(false);
  });

  it("with auto-pause on, A expiring while running pauses again for B", () => {
    const h = harness();
    toUbcProposal(h);
    h.sim.resume();
    h.runUntil(() => h.sim.getClock().status === "PAUSED");
    expect(h.sim.getClock().current_time).toBe(iso("10:45"));
    expect(h.trip(UBC_B).status).toBe("PROPOSED");
  });

  it("expiry only advances while running", () => {
    const h = harness();
    toUbcProposal(h);
    for (let i = 0; i < 40; i++) h.tick(60_000); // 40 wall-minutes paused
    expect(h.sim.getClock().current_time).toBe(iso("10:00"));
    expect(h.trip(UBC_A).status).toBe("PROPOSED");
  });

  it("returns the contract 409 codes, each carrying the trip", () => {
    const h = harness();
    toUbcProposal(h);
    const epoch = h.sim.getClock().epoch;
    h.sim.reject(UBC_A, epoch);
    expect(expectApiError(() => h.sim.approve(UBC_A, epoch), 409, "TRIP_REJECTED").trip?.status).toBe("REJECTED");
    h.sim.approve(UBC_B, epoch);
    expect(expectApiError(() => h.sim.reject(UBC_B, epoch), 409, "TRIP_NOT_PROPOSED").trip?.id).toBe(UBC_B);
    expectApiError(() => h.sim.approve("trip-nope", epoch), 404, "TRIP_NOT_FOUND");

    // Expired.
    const e = harness();
    e.sim.seek(iso("09:00"));
    e.sim.setSettings({ auto_pause_on_proposal: false });
    e.sim.setSpeed(300);
    e.sim.resume();
    e.runUntil(() => e.trip(UBC_A)?.status === "EXPIRED");
    const expired = expectApiError(() => e.sim.approve(UBC_A, e.sim.getClock().epoch), 409, "TRIP_EXPIRED");
    expect(expired.trip?.status).toBe("EXPIRED");

    // Stale epoch after a seek.
    const s = harness();
    toUbcProposal(s);
    const old = s.sim.getClock().epoch;
    s.sim.seek(iso("10:30"));
    expect(expectApiError(() => s.sim.approve(UBC_A, old), 409, "STALE_EPOCH").trip?.id).toBe(UBC_A);
    expect(s.sim.approve(UBC_A, old + 1).status).toBe("APPROVED");
  });

  it("emits strictly increasing seq, the current epoch, and schema-valid messages and state", () => {
    const h = harness({ nonHub: true, extraBuses: 5 });
    expect(StateResponse.safeParse(h.sim.getState()).success).toBe(true);
    toUbcProposal(h);
    const epoch = h.sim.getClock().epoch;
    h.sim.reject(UBC_A, epoch);
    h.sim.approve(UBC_B, epoch);
    h.sim.setSpeed(3600);
    h.sim.resume();
    h.runUntil(() => h.sim.listSurges().find((s) => s.id === UBC_SURGE)?.phase === "RESOLVED");
    h.sim.seek("2025-12-26T08:00:00-08:00");
    h.runUntil(() => h.sim.getClock().status === "PAUSED");
    h.sim.approve("trip-park-royal-2025-12-26-a", h.sim.getClock().epoch);
    h.sim.resume();
    h.tick(4000);
    const detail = h.sim.getTripDetail("trip-park-royal-2025-12-26-a");
    expect(detail?.surge.id).toBe("surge-park-royal-2025-12-26");

    let last = 0;
    let epochSeen = 0;
    for (const m of h.msgs) {
      const parsed = WsMessage.safeParse(m);
      if (!parsed.success) throw new Error(`${m.type}: ${JSON.stringify(parsed.error.issues).slice(0, 400)}`);
      expect(m.seq).toBeGreaterThan(last);
      expect(m.epoch).toBeGreaterThanOrEqual(epochSeen);
      last = m.seq;
      epochSeen = m.epoch;
    }
    const state = h.sim.getState();
    const parsed = StateResponse.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.last_seq).toBe(last);
    expect(state.buses.filter((b) => b.status === "REPOSITIONING")).toHaveLength(5);
    expect(state.surges.some((s) => s.hub_id === null && s.location_name === "Broadway-City Hall")).toBe(true);
  });
});

describe("other scenarios", () => {
  it("Park Royal: a depot bus from North Vancouver Transit Centre runs an extra R2 to Phibbs Exchange at 12:10", () => {
    const h = harness();
    h.sim.seek("2025-12-26T08:00:00-08:00");
    h.sim.setSpeed(900);
    h.sim.resume();
    h.runUntil(() => h.sim.getClock().status === "PAUSED");
    expect(h.sim.getClock().current_time).toBe("2025-12-26T09:00:00-08:00");
    const t = h.trip("trip-park-royal-2025-12-26-a");
    expect(t).toMatchObject({
      status: "PROPOSED",
      donor_route: null,
      route: { line_key: "R2" },
      departure_time: "2025-12-26T12:10:00-08:00",
      arrives_before_surge: true,
    });
    const bus = h.bus(t.bus.id);
    expect(bus?.source).toMatchObject({ type: "DEPOT", route: null, depot_name: "North Vancouver Transit Centre" });
    const detail = h.sim.getTripDetail(t.id);
    expect(detail?.progress.next_stop_id).toBe("4461"); // Park Royal @ Bay 5
    const surge = h.sim.listSurges()[0];
    expect(surge).toMatchObject({ severity: "LOW", drivers: [{ type: "HOLIDAY", label: "Boxing Day" }] });
  });

  it("Waterfront: moves a bus from the least-loaded route to the most overcrowded one, no driver", () => {
    const h = harness();
    h.sim.seek("2026-07-25T10:00:00-07:00");
    h.sim.setSpeed(900);
    h.sim.resume();
    h.runUntil(() => h.sim.getClock().status === "PAUSED");
    const ranking = getWorld().waterfrontRanking;
    const t = h.trip("trip-waterfront-2026-07-25-a");
    expect(t.route.line_key).toBe(ranking[0].route.line_key);
    expect(t.donor_route?.line_key).toBe(ranking[ranking.length - 1].route.line_key);
    expect(t.route.load_before_pct).toBeGreaterThan(t.donor_route?.load_before_pct ?? 100);
    expect(h.sim.listSurges()[0]).toMatchObject({ drivers: [], severity: "HIGH" });
  });
});

describe("with the real synthesis", () => {
  it("runs the UBC story with schema-valid output and a real magnitude", async () => {
    const real = await vi.importActual<typeof import("./synth")>("./synth");
    const h = harness({ synth: real.synth });
    toUbcProposal(h);
    const surge = h.sim.listSurges()[0];
    expect(surge.magnitude.surge_index).toBe(1.79);
    expect(surge.magnitude.predicted_pings).toBe(Math.round(surge.magnitude.typical_pings * 1.79));
    expect(surge.magnitude.lower_80).toBeLessThan(surge.magnitude.predicted_pings);
    expect(surge.predicted_destinations[0].expected_pings).toBeGreaterThan(0);
    h.sim.approve(UBC_A, h.sim.getClock().epoch);
    h.sim.setSpeed(3600);
    h.sim.resume();
    h.runUntil(() => h.sim.listSurges()[0]?.phase === "RESOLVED");
    const resolved = h.sim.listSurges()[0];
    expect(resolved.actual?.surge_index).toBe(1.88);
    expect(resolved.actual?.pings).toBe(real.synth.actualPings("ubc", "2025-12-06", 14));
    for (const m of h.msgs) expect(WsMessage.safeParse(m).success).toBe(true);
    expect(StateResponse.safeParse(h.sim.getState()).success).toBe(true);
  });
});
