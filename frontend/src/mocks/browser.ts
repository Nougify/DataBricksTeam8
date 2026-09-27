// Mock-mode bootstrap (spec §12): the MSW service worker for REST plus the MockSim singleton and its 250 ms timer.
// Loaded only through dynamic imports (lib/api/mockGate.ts, lib/live/createTransport.ts), so none of it ships
// when NEXT_PUBLIC_USE_MOCKS is off.
import { getMockSim, startMockSimTimer } from "./sim/instance";

let started: Promise<void> | null = null;

/** Starts MSW and the simulator once; later calls return the same promise. */
export function startMocks(): Promise<void> {
  started ??= (async () => {
    const [{ setupWorker }, { handlers }] = await Promise.all([import("msw/browser"), import("./handlers")]);
    const worker = setupWorker(...handlers);
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
    getMockSim();
    startMockSimTimer();
  })().catch((err: unknown) => {
    started = null;
    throw err;
  });
  return started;
}

/** Dev-only: close every fake WebSocket so reconnect handling can be exercised (spec §12.3). */
export function dropMockConnections(): void {
  getMockSim().dropConnections();
}
