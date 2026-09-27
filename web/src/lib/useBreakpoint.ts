// Viewport hooks for the few places where behaviour (not just layout) changes with the screen size:
// the side panel is a column on desktop, a drawer on tablet and a stacked section on phone (spec §5).
// Layout itself stays in Tailwind breakpoints (md = 768, xl = 1280), which these queries mirror.
// Every hook returns its server value during SSR and hydration, then follows the media query.
import { useSyncExternalStore } from "react";

export type Breakpoint = "phone" | "tablet" | "desktop";

/** Phone < 768 px, tablet 768–1279 px, desktop ≥ 1280 px (spec §5). */
export const BREAKPOINT_QUERIES = {
  tablet: "(min-width: 768px)",
  desktop: "(min-width: 1280px)",
} as const;

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

// One subscribe function per query string, so useSyncExternalStore doesn't resubscribe every render.
const subscribers = new Map<string, (onChange: () => void) => () => void>();
function subscriberFor(query: string) {
  let fn = subscribers.get(query);
  if (!fn) {
    fn = subscribeTo(query);
    subscribers.set(query, fn);
  }
  return fn;
}

/** True while `query` matches. Returns `serverValue` during SSR and hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** "phone" | "tablet" | "desktop". Renders as "desktop" on the server. */
export function useBreakpoint(): Breakpoint {
  const atLeastTablet = useMediaQuery(BREAKPOINT_QUERIES.tablet, true);
  const atLeastDesktop = useMediaQuery(BREAKPOINT_QUERIES.desktop, true);
  if (atLeastDesktop) return "desktop";
  return atLeastTablet ? "tablet" : "phone";
}

/** True when the viewer asked for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)", false);
}
