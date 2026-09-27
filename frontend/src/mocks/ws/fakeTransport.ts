// In-browser fake of the simulation WebSocket (spec §12.3): a SimTransport over the MockSim singleton.
// Messages arrive asynchronously, one task each and in order, as JSON round-tripped plain objects, so the
// client sees exactly what it would get off the wire. MockSim already obeys the contract's rate limits.
// "Drop connection" (dropMockConnections) closes every open fake socket so the reconnect path runs.
import type { SimTransport, TransportHandlers } from "@/lib/live/transport";
import { getMockSim } from "@/mocks/sim/instance";
import type { MockSimApi } from "@/mocks/sim/types";

export function createFakeTransport(sim: MockSimApi = getMockSim()): SimTransport {
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let unDrop: (() => void) | null = null;

  const teardown = () => {
    unsubscribe?.();
    unDrop?.();
    unsubscribe = null;
    unDrop = null;
  };

  return {
    connect(handlers: TransportHandlers) {
      queueMicrotask(() => {
        if (!closed) handlers.onStatus("connecting");
      });
      setTimeout(() => {
        if (closed) return;
        unsubscribe = sim.subscribe((msg) => {
          const wire = JSON.stringify(msg);
          setTimeout(() => {
            if (!closed) handlers.onMessage(JSON.parse(wire) as unknown);
          }, 0);
        });
        unDrop = sim.onDropConnections(() => {
          if (closed) return;
          closed = true;
          teardown();
          handlers.onStatus("closed");
        });
        handlers.onStatus("open");
      }, 0);
    },
    close() {
      closed = true;
      teardown();
    },
  };
}
