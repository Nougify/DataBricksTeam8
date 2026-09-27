// Throttled sim-hour key for time-dependent queries (spec §11.2). It follows the server clock's
// local_date + hour and the store epoch, and changes:
// - immediately below 900x, on an epoch change (seek), and on pause;
// - at most once every 2 s of wall time at 900x and above;
// - at 3600x, only for queries whose view is `visible` (others catch up on pause or when shown).
import { useEffect, useState, useSyncExternalStore } from "react";
import { clockLocal } from "./clock";
import { useSim, type LiveState } from "./store";

export interface SimHourKey {
  localDate: string | null;
  hour: number | null;
  epoch: number;
  /** The server sim time (ISO) captured when the key changed; send it as `?at=`. Null before the first snapshot. */
  at: string | null;
}

export const EMPTY_HOUR_KEY: SimHourKey = { localDate: null, hour: null, epoch: 0, at: null };

const THROTTLE_FROM_SPEED = 900;
const VISIBLE_ONLY_FROM_SPEED = 3600;
const THROTTLE_MS = 2000;

function targetKey(s: LiveState): SimHourKey {
  if (!s.clock) return EMPTY_HOUR_KEY;
  const { local_date, hour } = clockLocal(s.clock);
  return { localDate: local_date, hour, epoch: s.epoch, at: s.clock.current_time };
}

const sameKey = (a: SimHourKey, b: SimHourKey) =>
  a.localDate === b.localDate && a.hour === b.hour && a.epoch === b.epoch;

export type KeyDecision = { kind: "keep" } | { kind: "apply" } | { kind: "wait"; ms: number } | { kind: "defer" };

/** Pure throttling decision; exported for tests. */
export function decideKeyUpdate(
  current: SimHourKey,
  target: SimHourKey,
  ctx: { paused: boolean; speed: number; visible: boolean; sinceLastChangeMs: number },
): KeyDecision {
  if (sameKey(current, target)) return { kind: "keep" };
  if (current.at === null || target.epoch !== current.epoch || ctx.paused) return { kind: "apply" };
  if (ctx.speed >= VISIBLE_ONLY_FROM_SPEED && !ctx.visible) return { kind: "defer" };
  if (ctx.speed >= THROTTLE_FROM_SPEED && ctx.sinceLastChangeMs < THROTTLE_MS) {
    return { kind: "wait", ms: THROTTLE_MS - ctx.sinceLastChangeMs };
  }
  return { kind: "apply" };
}

function createHourKeySource(initialVisible: boolean) {
  let key = targetKey(useSim.getState());
  let visible = initialVisible;
  let lastChange = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let unsubscribeStore: (() => void) | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const evaluate = () => {
    const s = useSim.getState();
    // Hold the key while a seek or reset is settling; the snapshot's new epoch releases it.
    if (s.pendingSeek || s.resyncing) return;
    const target = targetKey(s);
    const now = Date.now();
    const decision = decideKeyUpdate(key, target, {
      paused: s.clock?.status !== "RUNNING",
      speed: s.clock?.speed ?? 1,
      visible,
      sinceLastChangeMs: now - lastChange,
    });
    if (decision.kind === "apply") {
      clearTimer();
      key = target;
      lastChange = now;
      for (const l of listeners) l();
    } else if (decision.kind === "wait") {
      timer ??= setTimeout(() => {
        timer = null;
        evaluate();
      }, decision.ms);
    } else if (decision.kind === "keep") {
      clearTimer();
    }
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeStore = useSim.subscribe((s, prev) => {
          if (
            s.clock !== prev.clock ||
            s.epoch !== prev.epoch ||
            s.pendingSeek !== prev.pendingSeek ||
            s.resyncing !== prev.resyncing
          ) {
            evaluate();
          }
        });
        evaluate();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeStore?.();
          unsubscribeStore = null;
          clearTimer();
        }
      };
    },
    getSnapshot: () => key,
    setVisible(next: boolean) {
      if (next === visible) return;
      visible = next;
      if (visible) evaluate();
    },
  };
}

const serverSnapshot = () => EMPTY_HOUR_KEY;

/** The sim hour + epoch that time-dependent queries key on. Pass `visible: false` for views not on screen. */
export function useSimHourKey(opts?: { visible?: boolean }): SimHourKey {
  const visible = opts?.visible ?? true;
  // Created once per component; visibility changes are pushed in below instead of recreating the source.
  const [source] = useState(() => createHourKeySource(visible));
  useEffect(() => source.setVisible(visible), [source, visible]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, serverSnapshot);
}
