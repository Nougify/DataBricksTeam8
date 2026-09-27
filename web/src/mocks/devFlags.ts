// Dev-only URL flags for mock mode (web/DECISIONS.md "Dev flags"). Read from window.location.search; ignored in
// production builds and outside the browser.
//   ?mock_state=<view>:loading|empty|error   force one view's state (comma-separate several: forecast:error,origins:empty)
//   ?mock_nonhub=1                           add a non-hub surge (used by MockSim)
import { ENV } from "@/config/env";

export const MOCK_STATE_VIEWS = [
  "forecast",
  "origins",
  "late-night",
  "planner",
  "overview",
  "crowding",
  "recommendations",
  "findings",
  "timeline",
  "backtest",
  "validation",
  "routes-load",
] as const;
export type MockStateView = (typeof MOCK_STATE_VIEWS)[number];
export type MockStateKind = "loading" | "empty" | "error";

const KINDS: ReadonlySet<string> = new Set(["loading", "empty", "error"]);
const VIEWS: ReadonlySet<string> = new Set(MOCK_STATE_VIEWS);

/** Parse `mock_state` out of a query string. Unknown views or states are ignored. */
export function parseMockState(search: string): Map<MockStateView, MockStateKind> {
  const out = new Map<MockStateView, MockStateKind>();
  const raw = new URLSearchParams(search).getAll("mock_state");
  for (const value of raw) {
    for (const part of value.split(",")) {
      const idx = part.lastIndexOf(":");
      if (idx <= 0) continue;
      const view = part.slice(0, idx).trim();
      const kind = part.slice(idx + 1).trim();
      if (VIEWS.has(view) && KINDS.has(kind)) out.set(view as MockStateView, kind as MockStateKind);
    }
  }
  return out;
}

/** Parse `mock_nonhub` out of a query string: true for `1` or `true`. */
export function parseMockNonHub(search: string): boolean {
  const v = new URLSearchParams(search).get("mock_nonhub");
  return v === "1" || v === "true";
}

function currentSearch(): string {
  if (!ENV.isDev || typeof window === "undefined") return "";
  try {
    return window.location.search;
  } catch {
    return "";
  }
}

/** The forced state for a view from the current URL, or null (always null in production). */
export function mockStateFor(view: MockStateView): MockStateKind | null {
  return parseMockState(currentSearch()).get(view) ?? null;
}

/** Whether the current URL asks for the dev non-hub surge (always false in production). */
export function isMockNonHubEnabled(): boolean {
  return parseMockNonHub(currentSearch());
}
