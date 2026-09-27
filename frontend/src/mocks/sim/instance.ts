// The browser-wide MockSim singleton shared by the MSW handlers and the fake WebSocket (spec §12.2).
// Tests construct their own `new MockSim({ now, loadMonth })` instead.
import { MockSim } from "./mockSim";

export const STEP_INTERVAL_MS = 250;

let sim: MockSim | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function getMockSim(): MockSim {
  sim ??= new MockSim();
  return sim;
}

/** Resolves once MockSim has loaded its first feed months and built the start state. */
export function mockSimReady(): Promise<void> {
  return getMockSim().whenReady();
}

/** Starts the 250 ms step timer (idempotent), so clock ticks are capped at 4 per second. Browser only. */
export function startMockSimTimer(): void {
  if (timer !== null || typeof window === "undefined") return;
  const s = getMockSim();
  timer = setInterval(() => {
    try {
      s.step();
    } catch (err) {
      console.error("MockSim step failed", err);
    }
  }, STEP_INTERVAL_MS);
}
