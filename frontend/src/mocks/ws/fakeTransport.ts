// In-browser fake of the simulation WebSocket (spec §12.3): a SimTransport over the MockSim singleton, shaped like
// the backend's GET /ws. The first frame is the /state snapshot, then envelopes follow in order. Frames arrive
// asynchronously, one task each, as JSON round-tripped plain objects, so the client sees what it would get off
// the wire. "Drop connection" (dropMockConnections) closes every open fake socket so the reconnect path runs.
import type { SimTransport, TransportHandlers } from "@/lib/live/transport";
import { getMockSim } from "@/mocks/sim/instance";
import type { MockSimApi } from "@/mocks/sim/types";

export function createFakeTransport(sim: MockSimApi = getMockSim()): SimTransport {
  let closed = false;
  let disconnect: (() => void) | null = null;
  let unDrop: (() => void) | null = null;

  const teardown = () => {
    disconnect?.();
    unDrop?.();
    disconnect = null;
    unDrop = null;
  };

  return {
    connect(handlers: TransportHandlers) {
      queueMicrotask(() => {
        if (!closed) handlers.onStatus("connecting");
      });
      setTimeout(() => {
        if (closed) return;
        handlers.onStatus("open");
        // Snapshot and subscription happen together, so no envelope can fall between them.
        disconnect = sim.connect((frame) => {
          const wire = JSON.stringify(frame);
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
      }, 0);
    },
    close() {
      closed = true;
      teardown();
    },
  };
}
