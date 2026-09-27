// Surge episodes (DECISIONS.md "Surges → dispatch events"). v3 has no Surge object: DispatchEvents are the surges.
// For display only, consecutive visible events for the same place with gaps of 30 min or less are grouped into one
// episode with a window and a peak index. Halos, "next surge", map surge markers and the timeline use episodes;
// the events underneath are never merged or changed.
import { useMemo } from "react";
import { severityForIndex, type Severity } from "@/config/scenario";
import type { DispatchEvent, GeoPoint } from "@/lib/api/schemas";
import { useSim } from "./store";

/** Events at most this far apart (event_time to event_time) belong to the same episode. */
export const EPISODE_GAP_MS = 30 * 60_000;
/** Each event covers one 30-minute forecast slot starting at its event_time. */
export const EVENT_SLOT_MS = 30 * 60_000;

export type EpisodePhase = "UPCOMING" | "ACTIVE" | "RESOLVED";

export interface SurgeEpisode {
  /** Stable for the episode's lifetime: `${placeKey}|${first event id}`. */
  id: string;
  hub_id: string | null;
  /** Hub id, or source_location for events away from the hubs. */
  place: string;
  location: GeoPoint | null;
  /** event_time of the first event, ms. */
  startMs: number;
  /** event_time of the last event + one 30-minute slot, ms. */
  endMs: number;
  /** Highest surge_ratio among the events, or null if none has one. */
  peakIndex: number | null;
  peakAtMs: number | null;
  severity: Severity | null;
  /** Earliest actionable_at: when the console first knew about the episode. */
  firstActionableMs: number;
  events: DispatchEvent[];
}

const t = (iso: string) => Date.parse(iso);

/** Groups events into episodes, oldest first. Pure; `events` may be in any order. */
export function buildEpisodes(events: Iterable<DispatchEvent>): SurgeEpisode[] {
  const byPlace = new Map<string, DispatchEvent[]>();
  for (const e of events) {
    const place = e.hub_id ?? e.source_location;
    const list = byPlace.get(place);
    if (list) list.push(e);
    else byPlace.set(place, [e]);
  }
  const out: SurgeEpisode[] = [];
  for (const [place, list] of byPlace) {
    list.sort((a, b) => t(a.event_time) - t(b.event_time) || a.id.localeCompare(b.id));
    let group: DispatchEvent[] = [];
    const flush = () => {
      if (group.length === 0) return;
      let peak: DispatchEvent | null = null;
      for (const e of group) if (e.surge_ratio !== null && (peak === null || e.surge_ratio > peak.surge_ratio!)) peak = e;
      const first = group[0];
      out.push({
        id: `${place}|${first.id}`,
        hub_id: first.hub_id,
        place,
        location: first.location,
        startMs: t(first.event_time),
        endMs: t(group[group.length - 1].event_time) + EVENT_SLOT_MS,
        peakIndex: peak?.surge_ratio ?? null,
        peakAtMs: peak ? t(peak.event_time) : null,
        severity: severityForIndex(peak?.surge_ratio),
        firstActionableMs: Math.min(...group.map((e) => t(e.actionable_at))),
        events: group,
      });
      group = [];
    };
    for (const e of list) {
      const last = group[group.length - 1];
      if (last && t(e.event_time) - t(last.event_time) > EPISODE_GAP_MS) flush();
      group.push(e);
    }
    flush();
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.place.localeCompare(b.place));
}

export function episodePhase(ep: SurgeEpisode, nowMs: number): EpisodePhase {
  if (nowMs < ep.startMs) return "UPCOMING";
  if (nowMs < ep.endMs) return "ACTIVE";
  return "RESOLVED";
}

/** The episode now in progress at a place, else the next upcoming one, else null. */
export function currentOrNextEpisode(episodes: readonly SurgeEpisode[], place: string, nowMs: number): SurgeEpisode | null {
  let next: SurgeEpisode | null = null;
  for (const ep of episodes) {
    if (ep.place !== place) continue;
    const phase = episodePhase(ep, nowMs);
    if (phase === "ACTIVE") return ep;
    if (phase === "UPCOMING" && (next === null || ep.startMs < next.startMs)) next = ep;
  }
  return next;
}

/** Warning given: minutes from when the console first knew about the episode to its start (0 if reactive). */
export function episodeLeadMinutes(ep: SurgeEpisode): number {
  return Math.max(0, Math.round((ep.startMs - ep.firstActionableMs) / 60_000));
}

/** The most recent episode at a place that ended within `withinMs` before `nowMs`, or null. */
export function latestResolvedEpisode(
  episodes: readonly SurgeEpisode[],
  place: string,
  nowMs: number,
  withinMs: number,
): SurgeEpisode | null {
  let best: SurgeEpisode | null = null;
  for (const ep of episodes) {
    if (ep.place !== place || ep.endMs > nowMs || nowMs - ep.endMs > withinMs) continue;
    if (best === null || ep.endMs > best.endMs) best = ep;
  }
  return best;
}

/** Episodes from the store's visible events, memoised on the events map. */
export function useEpisodes(): SurgeEpisode[] {
  const events = useSim((s) => s.events);
  return useMemo(() => buildEpisodes(Object.values(events)), [events]);
}
