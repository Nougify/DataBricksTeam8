// The browser-wide MockSim singleton shared by the MSW handlers and the fake WebSocket (spec §12.2).
// Tests construct their own `new MockSim({ now })` instead.
import { ENV } from "@/config/env";
import { isMockNonHubEnabled } from "@/mocks/devFlags";
import { MockSim } from "./mockSim";
import type { MockSimApi } from "./types";

export const STEP_INTERVAL_MS = 250;

let sim: MockSim | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** Dev flag `?mock_buses=N` (0-200): extra REPOSITIONING buses for the 3600x smoothness test. */
function extraBusesFlag(): number {
  if (!ENV.isDev || typeof window === "undefined") return 0;
  try {
    const n = Number(new URLSearchParams(window.location.search).get("mock_buses") ?? "0");
    return Number.isFinite(n) ? Math.max(0, Math.min(200, Math.floor(n))) : 0;
  } catch {
    return 0;
  }
}

export function getMockSim(): MockSimApi {
  sim ??= new MockSim({ nonHub: isMockNonHubEnabled(), extraBuses: extraBusesFlag() });
  return sim;
}

/** Starts the 250 ms step timer (idempotent). Browser only. */
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
