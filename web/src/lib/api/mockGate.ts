// In mock mode, REST calls and the live connection must wait until MSW and MockSim are running, or the
// first requests race the service worker and hit the real network. Outside mock mode this is a no-op.
import { ENV } from "@/config/env";

let started: Promise<void> | null = null;

export function mocksReady(): Promise<void> {
  if (!ENV.useMocks || typeof window === "undefined") return Promise.resolve();
  started ??= import("@/mocks/browser")
    .then((m) => m.startMocks())
    .catch((err: unknown) => {
      // Let the next caller try again; requests fall through to the network and fail visibly meanwhile.
      started = null;
      console.error("Mock mode failed to start", err);
    });
  return started;
}
