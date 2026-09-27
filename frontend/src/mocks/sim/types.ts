// The seam between MockSim (mockSim.ts), its browser singleton (instance.ts), the MSW handlers and the fake
// WebSocket.
import type {
  AdditionalTrip,
  Bus,
  Clock,
  DispatchEvent,
  EventStatus,
  Meta,
  Speed,
  StateResponse,
  WsMessage,
} from "@/lib/api/schemas";

/** Thrown by MockSim; the handlers turn it into the backend's `{ error: { code, message } }` body. */
export class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A WebSocket frame: the bootstrap snapshot first, then envelopes. */
export type MockFrame = StateResponse | WsMessage;

export interface MockSimApi {
  getClock(): Clock;
  getMeta(): Meta;
  getState(): StateResponse;
  pause(): Clock;
  resume(): Clock;
  setSpeed(speed: Speed): Clock;
  /** Rebuilds state at `iso` (loading feed months as needed), then emits `system.reset`. */
  seek(iso: string): Promise<Clock>;
  approve(tripId: string): AdditionalTrip;
  reject(tripId: string): AdditionalTrip;
  listDispatchEvents(filters?: { from?: string; to?: string; hub_id?: string; status?: EventStatus }): DispatchEvent[];
  getDispatchEvent(eventId: string): DispatchEvent | undefined;
  listBuses(): Bus[];
  getBus(busId: string): Bus | undefined;
  listTrips(): AdditionalTrip[];
  getTrip(tripId: string): AdditionalTrip | undefined;
  /**
   * Opens a live channel: `fn` gets the /state snapshot first, then every envelope, in order, as they are
   * emitted. Returns an unsubscribe function.
   */
  connect(fn: (frame: MockFrame) => void): () => void;
  /** Advances to wall time `wallNow` (default now) and emits messages. The 250 ms timer calls this. */
  step(wallNow?: number): void;
  dropConnections(): void;
  onDropConnections(fn: () => void): () => void;
}
