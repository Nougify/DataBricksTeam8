// Pure reducer for the live simulation state: a /state snapshot plus WebSocket envelopes (backendspec.md §9, v3).
// It also reports effects (toasts, resync) for the connection layer to act on; it never performs them.
import type { AdditionalTrip, Bus, Clock, DispatchEvent, StateResponse, WsMessage } from "@/lib/api/schemas";

export interface SimSlice {
  clock: Clock | null;
  /** Wall ms (Date.now()) when the clock was last set by the server; the base for extrapolation. */
  receivedAt: number;
  epoch: number;
  lastSeq: number;
  /** Visible dispatch events (actionable at or before the sim time), by id. */
  events: Record<string, DispatchEvent>;
  trips: Record<string, AdditionalTrip>;
  buses: Record<string, Bus>;
  /** True between a `system.reset` (or a sequence gap) and the /state snapshot that follows it. */
  resyncing: boolean;
  /** simulation_time of the last applied message, for "Showing data as of …" notes. */
  lastSimTime: string | null;
}

export type SimEffect =
  | { kind: "trip-proposed"; trip: AdditionalTrip }
  | { kind: "auto-paused" }
  | { kind: "event-new"; event: DispatchEvent }
  | { kind: "trip-expired"; trip: AdditionalTrip }
  | { kind: "system-error"; message: string }
  | { kind: "reset"; epoch: number };

export const emptySim: SimSlice = {
  clock: null,
  receivedAt: 0,
  epoch: 0,
  lastSeq: 0,
  events: {},
  trips: {},
  buses: {},
  resyncing: false,
  lastSimTime: null,
};

function indexBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

/** Replaces everything with the snapshot. Always applied, even with a lower epoch (e.g. after a server restart). */
export function applySnapshot(s: SimSlice, state: StateResponse, wallNow: number): SimSlice {
  return {
    ...s,
    clock: state.simulation,
    receivedAt: wallNow,
    epoch: state.epoch,
    lastSeq: state.last_seq,
    events: indexBy(state.dispatch_events, (x) => x.id),
    trips: indexBy(state.additional_trips, (x) => x.id),
    buses: indexBy(state.buses, (x) => x.id),
    resyncing: false,
    lastSimTime: state.simulation.current_time,
  };
}

const NO_EFFECTS: SimEffect[] = [];

/**
 * Applies one message. Filtering rules (backendspec.md §9):
 * - `system.reset` applies whenever its `data.epoch` is newer than ours: set resyncing and emit `reset`.
 * - Otherwise drop it if its epoch is older than ours, or its seq is at or below lastSeq.
 * - A non-reset message from a newer epoch means we missed the reset, and a seq gap means we missed messages;
 *   both trigger a resync.
 */
export function applyMessage(s: SimSlice, msg: WsMessage, wallNow: number): { sim: SimSlice; effects: SimEffect[] } {
  if (msg.type === "system.reset") {
    if (msg.data.epoch <= s.epoch) return { sim: s, effects: NO_EFFECTS };
    return {
      sim: { ...s, resyncing: true, lastSimTime: msg.simulation_time },
      effects: [{ kind: "reset", epoch: msg.data.epoch }],
    };
  }
  if (msg.epoch < s.epoch) return { sim: s, effects: NO_EFFECTS };
  if (msg.epoch > s.epoch) {
    return { sim: { ...s, resyncing: true }, effects: [{ kind: "reset", epoch: msg.epoch }] };
  }
  if (msg.seq <= s.lastSeq) return { sim: s, effects: NO_EFFECTS };
  if (msg.seq > s.lastSeq + 1) {
    return { sim: { ...s, resyncing: true }, effects: [{ kind: "reset", epoch: msg.epoch }] };
  }

  const base: SimSlice = { ...s, lastSeq: msg.seq, lastSimTime: msg.simulation_time };

  switch (msg.type) {
    case "clock.updated": {
      const { reason, ...clock } = msg.data;
      if (s.clock && clock.epoch < s.clock.epoch) return { sim: base, effects: NO_EFFECTS };
      const effects: SimEffect[] = reason === "AUTO_PAUSE_PROPOSAL" ? [{ kind: "auto-paused" }] : NO_EFFECTS;
      return { sim: { ...base, clock, receivedAt: wallNow }, effects };
    }
    case "system.error":
      return { sim: base, effects: [{ kind: "system-error", message: msg.data.message }] };
    case "dispatch_event.updated": {
      const event = msg.data;
      const isNew = !(event.id in s.events);
      return {
        sim: { ...base, events: { ...s.events, [event.id]: event } },
        effects: isNew ? [{ kind: "event-new", event }] : NO_EFFECTS,
      };
    }
    case "proposal.created":
    case "proposal.updated":
    case "trip.updated": {
      const trip = msg.data;
      const prev = s.trips[trip.id];
      const effects: SimEffect[] = [];
      if (msg.type === "proposal.created" && trip.status === "PROPOSED" && prev?.status !== "PROPOSED") {
        effects.push({ kind: "trip-proposed", trip });
      }
      if (trip.status === "EXPIRED" && prev?.status !== "EXPIRED") effects.push({ kind: "trip-expired", trip });
      return { sim: { ...base, trips: { ...s.trips, [trip.id]: trip } }, effects };
    }
    case "bus.updated":
      return { sim: { ...base, buses: { ...s.buses, [msg.data.id]: msg.data } }, effects: NO_EFFECTS };
  }
}

export interface ApplyResult {
  sim: SimSlice;
  effects: SimEffect[];
  /** Messages after a reset (including the one that revealed a newer epoch or a gap); they wait for the next snapshot. */
  remaining: WsMessage[];
}

/** Applies messages in order and stops at the first reset, handing back what's left. */
export function applyMessages(s: SimSlice, msgs: readonly WsMessage[], wallNow: number): ApplyResult {
  let sim = s;
  const effects: SimEffect[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const result = applyMessage(sim, msg, wallNow);
    sim = result.sim;
    effects.push(...result.effects);
    if (result.effects.some((e) => e.kind === "reset")) {
      return { sim, effects, remaining: msgs.slice(msg.type === "system.reset" ? i + 1 : i) };
    }
  }
  return { sim, effects, remaining: [] };
}
