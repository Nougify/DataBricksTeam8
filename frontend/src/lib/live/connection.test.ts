import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getState } from "@/lib/api/endpoints";
import { backoffDelay, parseWsMessage, startLiveConnection, type LiveConnection } from "./connection";
import { useSim } from "./store";
import type { SimTransport, TransportHandlers } from "./transport";
import { BUS, EVENT, makeState, msg } from "./__tests__/fixtures";

vi.mock("@/lib/api/endpoints", () => ({ getState: vi.fn() }));
vi.mock("./effects", () => ({ handleSimEffects: vi.fn() }));

class FakeTransport implements SimTransport {
  handlers: TransportHandlers | null = null;
  connect(handlers: TransportHandlers) { this.handlers = handlers; handlers.onStatus("connecting"); }
  close() {}
  open() { this.handlers?.onStatus("open"); }
  send(message: unknown) { this.handlers?.onMessage(message); }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("v3 live connection", () => {
  let transport: FakeTransport;
  let connection: LiveConnection | null;

  beforeEach(() => {
    vi.useFakeTimers();
    useSim.setState(useSim.getInitialState(), true);
    transport = new FakeTransport();
    connection = null;
    vi.mocked(getState).mockReset();
  });

  afterEach(() => {
    connection?.stop();
    vi.useRealTimers();
  });

  it("buffers v3 events until the snapshot and replays only later sequence numbers", async () => {
    vi.mocked(getState).mockResolvedValueOnce(makeState());
    connection = startLiveConnection({ queryClient: new QueryClient(), transportFactory: () => transport });
    transport.open();
    transport.send(msg("bus.updated", { ...BUS, status: "RETURNING" }, 1042));
    transport.send(msg("dispatch_event.updated", { ...EVENT, status: "DISPATCHED" }, 1043));
    await flush();
    expect(useSim.getState().lastSeq).toBe(1043);
    expect(useSim.getState().dispatchEvents[EVENT.id].status).toBe("DISPATCHED");
  });

  it("accepts exactly v3 event names", () => {
    expect(parseWsMessage(msg("bus.updated", BUS, 1043))).not.toBeNull();
    expect(parseWsMessage({ ...msg("bus.updated", BUS, 1043), type: "surge.updated" })).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("doubles to the cap", () => {
    expect(backoffDelay(0, () => 0.5)).toBe(500);
    expect(backoffDelay(4, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, () => 0.5)).toBe(10_000);
  });
});
