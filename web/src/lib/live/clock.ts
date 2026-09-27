// Displayed sim time is extrapolated between server updates (spec §11.3):
// while RUNNING it is current_time + (wallNow − receivedAt) × speed, snapping back on every tick.
import { useMemo, useSyncExternalStore } from "react";
import type { Clock } from "@/lib/api/schemas";
import { useSim } from "./store";

/** Sim time in epoch ms, or NaN when no clock has been received yet. */
export function simNowMs(clock: Clock | null, receivedAt: number, wallNow: number): number {
  if (!clock) return Number.NaN;
  const base = Date.parse(clock.current_time);
  if (clock.status !== "RUNNING") return base;
  const extrapolated = base + Math.max(0, wallNow - receivedAt) * clock.speed;
  const max = Date.parse(clock.max_time);
  return Number.isFinite(max) ? Math.min(extrapolated, max) : extrapolated;
}

/** Current extrapolated sim time from the store; for rAF loops and event handlers outside React. */
export function getSimNowMs(): number {
  const { clock, receivedAt } = useSim.getState();
  return simNowMs(clock, receivedAt, Date.now());
}

const isRunning = () => useSim.getState().clock?.status === "RUNNING";
// React checks server snapshots with !==, so NaN would always look uncached (a dev "getServerSnapshot should
// be cached" error). Use -Infinity as the "no clock" sentinel inside useSyncExternalStore and map it back.
const NO_CLOCK = Number.NEGATIVE_INFINITY;
const serverSnapshot = () => NO_CLOCK;

/**
 * One source per hook instance: a requestAnimationFrame loop that publishes the sim time at most every
 * `throttleMs`, runs only while the clock is RUNNING, and stops while the document is hidden.
 */
function createSimNowSource(throttleMs: number) {
  let value = getSimNowMs();
  const listeners = new Set<() => void>();
  let raf = 0;
  let lastPublish = -Infinity;
  let unsubscribeStore: (() => void) | null = null;

  const publish = () => {
    const next = getSimNowMs();
    if (Object.is(next, value)) return;
    value = next;
    for (const l of listeners) l();
  };

  const frame = (t: number) => {
    raf = 0;
    if (document.hidden || !isRunning()) return;
    if (t - lastPublish >= throttleMs) {
      lastPublish = t;
      publish();
    }
    raf = requestAnimationFrame(frame);
  };

  const ensureLoop = () => {
    if (!raf && !document.hidden && isRunning()) raf = requestAnimationFrame(frame);
  };

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      publish();
      ensureLoop();
    }
  };

  const start = () => {
    unsubscribeStore = useSim.subscribe((s, prev) => {
      if (s.clock === prev.clock && s.receivedAt === prev.receivedAt) return;
      // While running the loop picks the new base up on its next frame; when paused, show it now.
      if (s.clock?.status === "RUNNING") ensureLoop();
      else publish();
    });
    document.addEventListener("visibilitychange", onVisibility);
    publish();
    ensureLoop();
  };

  const stop = () => {
    unsubscribeStore?.();
    unsubscribeStore = null;
    document.removeEventListener("visibilitychange", onVisibility);
    cancelAnimationFrame(raf);
    raf = 0;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => value,
  };
}

/** Extrapolated sim time (epoch ms, NaN before the first snapshot); re-renders at most every `throttleMs`. */
export function useSimNow(throttleMs = 250): number {
  const source = useMemo(() => createSimNowSource(throttleMs), [throttleMs]);
  const value = useSyncExternalStore(source.subscribe, source.getSnapshot, serverSnapshot);
  return value === NO_CLOCK ? Number.NaN : value;
}
