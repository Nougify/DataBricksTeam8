// Typed test data for the live layer, built from payloads captured from the real v3 backend (validated through the
// schemas on the way in). The clock is moved to 2025-12-06 10:00 PST so time maths reads naturally.
import * as S from "@/lib/api/schemas";
import state from "@/lib/api/__fixtures__/state.json";

const captured = S.StateResponse.parse(state);

/** 2025-12-06 10:00 PST, PAUSED, 60x, epoch 3. */
export const CLOCK: S.Clock = {
  current_time: "2025-12-06T10:00:00-08:00",
  local_date: "2025-12-06",
  hour: 10,
  speed: 60,
  status: "PAUSED",
  min_time: "2025-11-15T00:00:00-08:00",
  max_time: "2026-08-31T23:00:00-07:00",
  approval_mode: "MANUAL",
  auto_pause_on_proposal: true,
  epoch: 3,
};
export const EVENT: S.DispatchEvent = captured.dispatch_events[0];
export const BUS: S.Bus = captured.buses[0];
export const TRIP: S.AdditionalTrip = captured.additional_trips.find((t) => t.status === "PROPOSED")!;

export function makeState(overrides: Partial<S.StateResponse> = {}): S.StateResponse {
  return {
    epoch: 3,
    last_seq: 1042,
    simulation: CLOCK,
    dispatch_events: [EVENT],
    buses: [BUS],
    additional_trips: [TRIP],
    ...overrides,
  };
}

type Data<T extends S.WsMessageType> = S.WsMessageOf<T>["data"];

export function msg<T extends S.WsMessageType>(
  type: T,
  data: Data<T>,
  seq: number,
  epoch = 3,
  simulationTime = "2025-12-06T10:00:00-08:00",
): S.WsMessageOf<T> {
  return { type, seq, epoch, simulation_time: simulationTime, data } as S.WsMessageOf<T>;
}

/** A clock.updated tick (reason null) at `time`. */
export function tick(time: string, seq: number, clock: S.Clock = CLOCK, epoch = 3) {
  return msg("clock.updated", { ...clock, current_time: time, reason: null }, seq, epoch, time);
}
