// The live store: simulation state from /state + WebSocket (reducer.ts), UI selection, and connection status.
// Components subscribe with selectors; rAF loops read it with useSim.getState() outside React.
import { create } from "zustand";
import type { AdditionalTrip, Clock, OriginsBasis, StateResponse, TripStatus, WsMessage } from "@/lib/api/schemas";
import { applyMessages, applySnapshot, emptySim, type SimEffect, type SimSlice } from "./reducer";

export const HUB_TABS = ["now", "origins", "dispatch", "routes", "late-night", "planner", "findings"] as const;
export type HubTab = (typeof HUB_TABS)[number];

export const LAYER_KEYS = ["origins", "surges", "buses", "routes", "catchments"] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];
export const DEFAULT_LAYERS: readonly LayerKey[] = ["origins", "surges", "buses", "catchments"];

export const DEFAULT_HORIZON = 6;

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export interface UiSlice {
  selectedHubId: string | null;
  tab: HubTab;
  previewTripId: string | null;
  focusTripId: string | null;
  originsBasis: OriginsBasis;
  horizon: number;
  layers: LayerKey[];
  hoverOrigin: string | null;
  highlightRouteId: string | null;
  aboutOpen: boolean;
  /** True between a seek request and the post-reset /state snapshot. */
  pendingSeek: boolean;
}

export interface StatusSlice {
  connection: ConnectionState;
  /** A configuration problem the UI should show prominently (e.g. ws:// on an https page). */
  configError: string | null;
  /** Text for the polite aria-live region. */
  announcement: string;
  /** Sim time from a shared link's `t` param; the UI offers "Jump there?" and clears it. */
  pendingLinkTime: string | null;
}

export interface LiveActions {
  setSnapshot(state: StateResponse): void;
  /** Applies messages up to the first reset; the connection buffers `remaining` until the next snapshot. */
  applyMessages(msgs: readonly WsMessage[]): { effects: SimEffect[]; remaining: WsMessage[] };
  setConnection(connection: ConnectionState): void;
  /** Applies a Clock returned by a REST call. A newer epoch (a seek) sets pendingSeek until the reset lands. */
  setClockOptimistic(clock: Clock): void;
  /** Upserts a trip from a REST response without rolling back a newer status already received live. */
  upsertTrip(trip: AdditionalTrip): void;
  selectHub(hubId: string | null, tab?: HubTab): void;
  setTab(tab: HubTab): void;
  startPreview(tripId: string): void;
  exitPreview(): void;
  setFocusTrip(tripId: string | null): void;
  setOriginsBasis(basis: OriginsBasis): void;
  setHorizon(horizon: number): void;
  toggleLayer(layer: LayerKey): void;
  setLayers(layers: readonly LayerKey[]): void;
  setHoverOrigin(origin: string | null): void;
  setHighlightRoute(routeId: string | null): void;
  setAboutOpen(open: boolean): void;
  setConfigError(message: string | null): void;
  announce(text: string): void;
  setPendingLinkTime(time: string | null): void;
}

export type LiveState = SimSlice & UiSlice & StatusSlice & LiveActions;

const initialUi: UiSlice = {
  selectedHubId: null,
  tab: "now",
  previewTripId: null,
  focusTripId: null,
  originsBasis: "actual",
  horizon: DEFAULT_HORIZON,
  layers: [...DEFAULT_LAYERS],
  hoverOrigin: null,
  highlightRouteId: null,
  aboutOpen: false,
  pendingSeek: false,
};

const initialStatus: StatusSlice = {
  connection: "connecting",
  configError: null,
  announcement: "",
  pendingLinkTime: null,
};

function pickSim(s: LiveState): SimSlice {
  return {
    clock: s.clock,
    receivedAt: s.receivedAt,
    epoch: s.epoch,
    lastSeq: s.lastSeq,
    dispatchEvents: s.dispatchEvents,
    surges: s.surges,
    trips: s.trips,
    buses: s.buses,
    hubs: s.hubs,
    resyncing: s.resyncing,
    lastSimTime: s.lastSimTime,
  };
}

// Trip statuses only move forward; terminal ones share the last rank.
const TRIP_STATUS_RANK: Record<TripStatus, number> = {
  PROPOSED: 0,
  APPROVED: 1,
  BUS_EN_ROUTE: 2,
  IN_SERVICE: 3,
  COMPLETED: 4,
  REJECTED: 4,
  EXPIRED: 4,
  CANCELLED: 4,
};

const sameClockSettings = (a: Clock, b: Clock) =>
  a.status === b.status && a.speed === b.speed && a.auto_pause_on_proposal === b.auto_pause_on_proposal;

export const useSim = create<LiveState>()((set, get) => ({
  ...emptySim,
  ...initialUi,
  ...initialStatus,

  setSnapshot(state) {
    const s = get();
    // A second seek may already be in flight: keep its optimistic clock until its own reset arrives.
    const stillPending = s.pendingSeek && s.clock !== null && s.clock.epoch > state.epoch;
    const next = applySnapshot(pickSim(s), state, Date.now());
    set(stillPending ? { ...next, clock: s.clock, receivedAt: s.receivedAt, pendingSeek: true } : { ...next, pendingSeek: false });
  },

  applyMessages(msgs) {
    const before = pickSim(get());
    const { sim, effects, remaining } = applyMessages(before, msgs, Date.now());
    if (sim !== before) set(sim);
    return { effects, remaining };
  },

  setConnection(connection) {
    if (get().connection !== connection) set({ connection });
  },

  setClockOptimistic(clock) {
    const s = get();
    if (clock.epoch < s.epoch) return;
    const cur = s.clock;
    // The WebSocket already delivered this change and the clock has moved on since: keep the newer one.
    if (
      cur &&
      clock.epoch === cur.epoch &&
      sameClockSettings(cur, clock) &&
      Date.parse(cur.current_time) >= Date.parse(clock.current_time)
    ) {
      return;
    }
    set({ clock, receivedAt: Date.now(), pendingSeek: clock.epoch > s.epoch ? true : s.pendingSeek });
  },

  upsertTrip(trip) {
    const prev = get().trips[trip.id];
    if (prev && TRIP_STATUS_RANK[prev.status] > TRIP_STATUS_RANK[trip.status]) return;
    set({ trips: { ...get().trips, [trip.id]: trip } });
  },

  selectHub(hubId, tab) {
    const s = get();
    if (hubId === s.selectedHubId) {
      if (tab && tab !== s.tab) set({ tab });
      return;
    }
    set({
      selectedHubId: hubId,
      tab: tab ?? "now",
      previewTripId: null,
      focusTripId: null,
      hoverOrigin: null,
      highlightRouteId: null,
    });
  },

  setTab: (tab) => set({ tab }),
  startPreview: (tripId) => set({ previewTripId: tripId }),
  exitPreview: () => set({ previewTripId: null }),
  setFocusTrip: (tripId) => set({ focusTripId: tripId }),
  setOriginsBasis: (originsBasis) => set({ originsBasis }),
  setHorizon: (horizon) => set({ horizon }),

  toggleLayer(layer) {
    const layers = get().layers;
    set({ layers: layers.includes(layer) ? layers.filter((l) => l !== layer) : [...layers, layer] });
  },

  setLayers: (layers) => set({ layers: [...layers] }),
  setHoverOrigin: (hoverOrigin) => set({ hoverOrigin }),
  setHighlightRoute: (highlightRouteId) => set({ highlightRouteId }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setConfigError: (configError) => set({ configError }),

  announce(text) {
    // Screen readers skip an unchanged live region, so a repeated message gets a trailing no-break space.
    set((s) => ({ announcement: s.announcement === text ? `${text} ` : text }));
  },

  setPendingLinkTime: (pendingLinkTime) => set({ pendingLinkTime }),
}));
