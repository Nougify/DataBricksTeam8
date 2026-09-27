// Typed test data built from the message.txt examples (validated through the schemas on the way in).
import * as S from "@/lib/api/schemas";
import additionalTrip from "@/lib/api/__fixtures__/additional-trip.json";
import bus from "@/lib/api/__fixtures__/bus.json";
import clock from "@/lib/api/__fixtures__/clock.json";
import hubStatus from "@/lib/api/__fixtures__/hub-status.json";
import surge from "@/lib/api/__fixtures__/surge.json";

export const CLOCK = S.Clock.parse(clock); // 2025-12-06 10:00 PST, PAUSED, 60x, epoch 3
export const HUB = S.HubStatus.parse(hubStatus);
export const SURGE = S.Surge.parse(surge);
export const BUS = S.Bus.parse(bus);
export const TRIP = S.AdditionalTrip.parse(additionalTrip);

export function makeState(overrides: Partial<S.StateResponse> = {}): S.StateResponse {
  return {
    epoch: 3,
    last_seq: 1042,
    simulation: CLOCK,
    hubs: [HUB],
    surges: [SURGE],
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
