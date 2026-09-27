"use client";

import { useSyncExternalStore } from "react";
import { Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fmtTime } from "@/lib/format";
import { useSim, type ConnectionState } from "@/lib/live/store";
import { cn } from "@/lib/utils";

/**
 * A dropped connection counts as stale only after this long, so a quick reconnect doesn't flash a note
 * (and shift the layout) across every panel.
 */
export const STALE_GRACE_MS = 2000;

const isDisconnected = (c: ConnectionState) => c === "reconnecting" || c === "offline";

// One app-wide "stale" flag derived from the store's connection state, with the grace period applied.
let stale = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setStale(next: boolean) {
  if (stale === next) return;
  stale = next;
  for (const l of listeners) l();
}

useSim.subscribe((s, prev) => {
  const now = isDisconnected(s.connection);
  if (now === isDisconnected(prev.connection)) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (now) timer = setTimeout(() => setStale(true), STALE_GRACE_MS);
  else setStale(false);
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface Staleness {
  /** True while the live connection has been down for longer than the grace period. */
  stale: boolean;
  /** The last sim time received (ISO), for "Showing data as of 13:00". */
  asOf: string | null;
}

/**
 * Whether live data on screen may be out of date (spec §4.2 rule 1, §11.4): the live connection is
 * reconnecting or offline. Mock mode counts too, so "Drop connection" exercises the same path.
 */
export function useStaleness(): Staleness {
  const isStale = useSyncExternalStore(subscribe, () => stale, () => false);
  const lastSimTime = useSim((s) => s.lastSimTime);
  const clockTime = useSim((s) => s.clock?.current_time ?? null);
  return { stale: isStale, asOf: lastSimTime ?? clockTime };
}

export interface StaleNoteProps {
  /** Sim time (ISO) the data is from. Defaults to the last sim time received from the server. */
  asOf?: string | null;
  className?: string;
}

/** "Live connection lost. Showing data as of 13:00." Shown above data that is kept while disconnected. */
export function StaleNote({ asOf, className }: StaleNoteProps) {
  const fallback = useStaleness().asOf;
  const time = asOf ?? fallback;
  return (
    // role="status": the top bar already reports the drop; several panels shouldn't each interrupt.
    <Alert role="status" className={cn("text-sm", className)}>
      <Clock aria-hidden />
      <AlertDescription className="text-foreground">
        Live connection lost.{time ? ` Showing data as of ${fmtTime(time)}.` : " Showing the last data received."}
      </AlertDescription>
    </Alert>
  );
}
