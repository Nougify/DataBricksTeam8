// The seam between the mock simulator (mockSim.ts / instance.ts) and the read handlers + synthesis (synth.ts).
import type { AdditionalTrip, AdditionalTripDetail, Bus, Clock, DayType, HubStatus, StateResponse, Surge, WsMessage } from "@/lib/api/schemas";

export type MockHubId = "ubc" | "waterfront" | "park-royal";

/** Thrown by MockSim; the sim handlers turn it into the contract's `{ error: { code, message }, trip? }` body. */
export class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly trip?: AdditionalTrip,
  ) {
    super(message);
  }
}

export interface MockSimApi {
  getClock(): Clock;
  /** Current sim time in epoch ms (extrapolated to now while running). */
  nowMs(): number;
  getState(): StateResponse;
  pause(): Clock;
  resume(): Clock;
  setSpeed(speed: number): Clock;
  seek(iso: string): Clock;
  setSettings(s: { auto_pause_on_proposal: boolean }): Clock;
  approve(tripId: string, epoch: number): AdditionalTrip;
  reject(tripId: string, epoch: number, reason?: string): AdditionalTrip;
  listSurges(): Surge[];
  listBuses(): Bus[];
  listTrips(): AdditionalTrip[];
  getTrip(tripId: string): AdditionalTrip | undefined;
  getTripDetail(tripId: string): AdditionalTripDetail | undefined;
  subscribe(fn: (msg: WsMessage) => void): () => void;
  /** Advance to wall time `wallNow` (default Date.now()) and emit messages. The internal 250 ms timer calls this. */
  step(wallNow?: number): void;
  dropConnections(): void;
  onDropConnections(fn: () => void): () => void;
}

/** Synthesis API (synth.ts). Everything is deterministic: keyed by hub, local date and hour, never by call order. */
export interface SynthApi {
  dayTypeFor(localDate: string): DayType;
  /** Pings in the full Vancouver wall-clock hour. */
  actualPings(hubId: string, localDate: string, hour: number): number;
  /** Same hub, day type and hour, averaged over the trailing 8 weeks before localDate. */
  typicalPings(hubId: string, localDate: string, hour: number): number;
  /** Forecast for a target hour issued at issuedMs (start of a sim hour); 80% band ±(8% + 1% × lead hours). */
  forecastFor(hubId: string, issuedMs: number, targetLocalDate: string, targetHour: number): { forecast: number; lower_80: number; upper_80: number };
  hubStatusAt(
    hubId: string,
    simMs: number,
    extra: Pick<HubStatus, "next_surge" | "active_trip_count" | "pending_proposal_count">,
  ): HubStatus;
}
