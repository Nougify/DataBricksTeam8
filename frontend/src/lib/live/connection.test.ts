import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { StateResponse } from "@/lib/api/schemas";
import { getState } from "@/lib/api/endpoints";
import { handleSimEffects } from "./effects";
import { BOOTSTRAP_TIMEOUT_MS, backoffDelay, startLiveConnection, type LiveConnection } from "./connection";
import { useSim } from "./store";
import type { SimTransport, TransportHandlers } from "./transport";
import { BUS, CLOCK, EVENT, makeState, msg } from "./__tests__/fixtures";

vi.mock("@/lib/api/endpoints", () => ({ getState: vi.fn() }));
vi.mock("./effects", () => ({ handleSimEffects: vi.fn() }));

const getStateMock = vi.mocked(getState);

class FakeTransport implements SimTransport {
  handlers: TransportHandlers | null = null;
  closed = false;
  connect(handlers: TransportHandlers) {
    this.handlers = handlers;
    handlers.onStatus("connecting");
  }
  close() {
    this.closed = true;
  }
  open() {
    this.handlers?.onStatus("open");
  }
  drop() {
    this.handlers?.onStatus("closed");
  }
  send(message: unknown) {
    this.handlers?.onMessage(message);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const bus = (status: typeof BUS.status) => ({ ...BUS, status });

describe("startLiveConnection", () => {
  let transports: FakeTransport[];
  let queryClient: QueryClient;
  let connection: LiveConnection | null;

  const start = () => {
    connection = startLiveConnection({
      queryClient,
      transportFactory: () => {
        const t = new FakeTransport();
        transports.push(t);
        return t;
      },
    });
    return connection;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    useSim.setState(useSim.getInitialState(), true);
    transports = [];
    queryClient = new QueryClient();
    connection = null;
    getStateMock.mockReset();
    // Unless a test says otherwise, /state never answers.
    getStateMock.mockImplementation(() => new Promise<StateResponse>(() => {}));
    vi.mocked(handleSimEffects).mockReset();
  });

  afterEach(() => {
    connection?.stop();
    vi.useRealTimers();
  });

  it("applies the WebSocket's bootstrap snapshot, then goes live", () => {
    start();
    expect(useSim.getState().connection).toBe("connecting");
    const t = transports[0];
    t.open();
    t.send(makeState());

    const s = useSim.getState();
    expect(s.connection).toBe("live");
    expect(s.epoch).toBe(3);
    expect(s.lastSeq).toBe(1042);
    expect(s.events[EVENT.id]).toEqual(EVENT);
    expect(getStateMock).not.toHaveBeenCalled();

    t.send(msg("bus.updated", bus("DEADHEADING"), 1043));
    expect(useSim.getState().buses[BUS.id].status).toBe("DEADHEADING");
    t.send({ type: "surge.detected", seq: 1044, epoch: 3, simulation_time: CLOCK.current_time, data: {} }); // unknown: ignored
    expect(useSim.getState().lastSeq).toBe(1043);
  });

  it("without a bootstrap, fetches /state after the timeout and replays only this epoch's messages after last_seq", async () => {
    const snapshot = deferred<StateResponse>();
    getStateMock.mockReturnValueOnce(snapshot.promise);
    start();
    const t = transports[0];
    t.open();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS - 1);
    expect(getStateMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(getStateMock).toHaveBeenCalledTimes(1);

    // While /state is in flight (it will say epoch 3, last_seq 1042):
    t.send(msg("bus.updated", bus("WAITING"), 1100, 2)); // older epoch: dropped
    t.send(msg("bus.updated", bus("IN_SERVICE"), 1040)); // already in the snapshot: dropped
    t.send(msg("bus.updated", bus("RETURNING"), 1042)); // == last_seq: dropped
    t.send(msg("dispatch_event.updated", { ...EVENT, id: "event-new" }, 1043)); // replayed
    t.send(msg("bus.updated", bus("DEADHEADING"), 1044)); // replayed
    expect(useSim.getState().clock).toBeNull();

    snapshot.resolve(makeState());
    await flush();

    const s = useSim.getState();
    expect(s.connection).toBe("live");
    expect(s.lastSeq).toBe(1044);
    expect(s.buses[BUS.id].status).toBe("DEADHEADING");
    expect(s.events["event-new"]).toBeDefined();
    expect(handleSimEffects).toHaveBeenCalledWith([expect.objectContaining({ kind: "event-new" })], { queryClient });
  });

  it("ignores a late bootstrap that is older than the /state already applied", async () => {
    getStateMock.mockResolvedValueOnce(makeState({ last_seq: 1050 }));
    start();
    const t = transports[0];
    t.open();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    expect(useSim.getState().lastSeq).toBe(1050);
    t.send(makeState({ last_seq: 1042 }));
    expect(useSim.getState().lastSeq).toBe(1050);
  });

  it("repeats the whole startup after a reconnect, with backoff", async () => {
    start();
    transports[0].open();
    transports[0].send(makeState());
    expect(useSim.getState().connection).toBe("live");

    transports[0].drop();
    expect(useSim.getState().connection).toBe("reconnecting");
    expect(transports).toHaveLength(1);

    // First retry comes after 0.5 s ± 25%, never sooner than 0.5 s.
    await vi.advanceTimersByTimeAsync(499);
    expect(transports).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(transports).toHaveLength(2);

    // The sim moved on while we were away; the new bootstrap replaces everything.
    const second = transports[1];
    second.open();
    second.send(makeState({ epoch: 5, last_seq: 2000, simulation: { ...CLOCK, epoch: 5, current_time: "2025-12-06T12:00:00-08:00", hour: 12 } }));
    second.send(msg("bus.updated", bus("IN_SERVICE"), 2001, 5));

    const s = useSim.getState();
    expect(s.connection).toBe("live");
    expect(s.epoch).toBe(5);
    expect(s.lastSeq).toBe(2001);
    expect(s.clock?.hour).toBe(12);
    expect(s.buses[BUS.id].status).toBe("IN_SERVICE");
  });

  it("goes offline after repeated failures and keeps retrying", async () => {
    start();
    for (let i = 0; i < 5; i++) {
      transports[transports.length - 1].drop();
      await vi.advanceTimersByTimeAsync(12_500);
    }
    expect(transports.length).toBeGreaterThanOrEqual(6);
    transports[transports.length - 1].drop();
    expect(useSim.getState().connection).toBe("offline");
  });

  it("a /state failure counts as a dropped connection", async () => {
    getStateMock.mockRejectedValueOnce(new Error("boom"));
    start();
    transports[0].open();
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
    expect(transports[0].closed).toBe(true);
    expect(useSim.getState().connection).toBe("reconnecting");
  });

  it("on system.reset: resyncs /state, replays what arrived meanwhile, clears pendingSeek and invalidates time-dependent queries", async () => {
    start();
    const t = transports[0];
    t.open();
    t.send(makeState());

    // A seek: the REST response lands first (optimistic clock, pendingSeek), then the reset.
    const seekClock = { ...CLOCK, epoch: 4, current_time: "2026-02-11T13:00:00-08:00", local_date: "2026-02-11", hour: 13 };
    useSim.getState().setClockOptimistic(seekClock);
    expect(useSim.getState().pendingSeek).toBe(true);

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const snapshot = deferred<StateResponse>();
    getStateMock.mockReturnValueOnce(snapshot.promise);

    t.send(msg("system.reset", { epoch: 4, reason: "SEEK" }, 1043, 4));
    expect(useSim.getState().resyncing).toBe(true);
    expect(getStateMock).toHaveBeenCalledTimes(1);

    t.send(msg("bus.updated", bus("DEADHEADING"), 1044, 4)); // replayed
    t.send(msg("bus.updated", bus("WAITING"), 1044, 3)); // old epoch: dropped
    expect(useSim.getState().buses[BUS.id].status).toBe(BUS.status);

    snapshot.resolve(makeState({ epoch: 4, last_seq: 1043, simulation: seekClock }));
    await flush();

    const s = useSim.getState();
    expect(s.resyncing).toBe(false);
    expect(s.pendingSeek).toBe(false);
    expect(s.epoch).toBe(4);
    expect(s.buses[BUS.id].status).toBe("DEADHEADING");
    expect(invalidate).toHaveBeenCalledTimes(1);
    // The predicate only reads queryKey.
    const predicate = invalidate.mock.calls[0][0]?.predicate as unknown as (q: { queryKey: unknown[] }) => boolean;
    expect(predicate({ queryKey: ["dispatch-events", "ubc", "2026-02-11", 13, 4] })).toBe(true);
    expect(predicate({ queryKey: ["meta"] })).toBe(false);
  });

  it("a sequence gap refetches /state", async () => {
    start();
    const t = transports[0];
    t.open();
    t.send(makeState());
    getStateMock.mockResolvedValueOnce(makeState({ last_seq: 1050 }));
    t.send(msg("bus.updated", bus("DEADHEADING"), 1045));
    expect(getStateMock).toHaveBeenCalledTimes(1);
    await flush();
    expect(useSim.getState().lastSeq).toBe(1050);
    expect(useSim.getState().resyncing).toBe(false);
  });

  it("resync() without an open socket applies /state directly", async () => {
    start();
    transports[0].drop();
    getStateMock.mockResolvedValueOnce(makeState({ epoch: 4, last_seq: 7, simulation: { ...CLOCK, epoch: 4 } }));
    connection?.resync();
    await flush();
    expect(useSim.getState().epoch).toBe(4);
    expect(useSim.getState().connection).toBe("reconnecting");
  });

  it("stop() closes the transport and ignores anything after", async () => {
    start();
    const t = transports[0];
    t.open();
    t.send(makeState());
    connection?.stop();
    expect(t.closed).toBe(true);
    t.send(msg("bus.updated", bus("DEADHEADING"), 1043));
    t.drop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useSim.getState().buses[BUS.id].status).toBe(BUS.status);
    expect(transports).toHaveLength(1);
  });
});

describe("backoffDelay", () => {
  it("doubles from 0.5 s to a 10 s cap with ±25% jitter", () => {
    expect(backoffDelay(0, () => 0.5)).toBe(500);
    expect(backoffDelay(1, () => 0.5)).toBe(1000);
    expect(backoffDelay(4, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, () => 0.5)).toBe(10_000);
    expect(backoffDelay(1, () => 0)).toBe(750);
    expect(backoffDelay(1, () => 1)).toBe(1250);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(10, () => 1)).toBe(10_000);
  });
});
