// Turns reducer effects into toasts and aria-live announcements (spec §11.3, v3).
// Toast ids are stable per kind + entity, so repeats update in place instead of stacking, and at most
// three toasts are on screen at once (the oldest is dismissed first). New dispatch events are grouped per hub:
// at high speed a hub can raise one every 30 sim-minutes, and each replaces the hub's previous toast.
import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import { hubName } from "@/config/hubs";
import type { AdditionalTrip, DispatchEvent, RouteListItem } from "@/lib/api/schemas";
import { qk } from "@/lib/api/queryKeys";
import { fmtIndex, fmtTime } from "@/lib/format";
import type { SimEffect } from "./reducer";
import { useSim } from "./store";

const MAX_TOASTS = 3;
/** An auto-pause this close to a proposal (either order) is reported on the proposal's toast. */
const AUTO_PAUSE_WINDOW_MS = 300;
const PROPOSAL_TOAST_MS = 12_000;

export const PAUSED_FOR_REVIEW = "Simulation paused for review.";

export interface EffectContext {
  /** Used to read route names from the /routes cache. */
  queryClient?: QueryClient;
  /** Wall ms; injectable for tests. */
  now?: number;
}

/** Route short name for a trip: the /routes cache, then the feed's route key, then the raw id. */
export function tripRouteLabel(trip: AdditionalTrip, queryClient?: QueryClient): string {
  for (const hub of [null, true, false] as const) {
    const cached =
      hub === null
        ? queryClient?.getQueryData<RouteListItem[]>(qk.routes(null, false))
        : queryClient?.getQueryData<RouteListItem[]>(qk.routes(null, hub));
    const route = cached?.find((r) => r.route_id === trip.route_id);
    if (route) return route.short_name;
  }
  return trip.source_route ?? trip.route_id;
}

/** The hub a trip serves, from its dispatch event. */
export function tripHubId(trip: AdditionalTrip): string | null {
  return useSim.getState().events[trip.dispatch_event_id]?.hub_id ?? null;
}

/** "bus-01 → extra 49 trip at UBC". */
export function describeProposal(trip: AdditionalTrip, routeLabel: string, hubLabel: string | null): string {
  return `${trip.bus_id} → extra ${routeLabel} trip${hubLabel ? ` at ${hubLabel}` : ""}`;
}

/** "Surge forecast at UBC 13:00, 1.99×". */
export function eventToastText(event: DispatchEvent): string {
  const where = event.hub_id ? hubName(event.hub_id) : event.source_location;
  const index = event.surge_ratio === null ? "" : `, ${fmtIndex(event.surge_ratio)}`;
  return `Surge forecast at ${where} ${fmtTime(event.event_time)}${index}`;
}

// ---------- toast bookkeeping ----------

const onScreen: string[] = [];
let recentProposal: { trip: AdditionalTrip; at: number; paused: boolean } | null = null;
let recentAutoPauseAt = Number.NEGATIVE_INFINITY;

function forget(id: string) {
  const i = onScreen.indexOf(id);
  if (i >= 0) onScreen.splice(i, 1);
}

function show(id: string, title: string, options: Parameters<typeof toast>[1] = {}) {
  if (!onScreen.includes(id)) {
    while (onScreen.length >= MAX_TOASTS) toast.dismiss(onScreen.shift());
    onScreen.push(id);
  }
  toast(title, {
    ...options,
    id,
    onDismiss: () => forget(id),
    onAutoClose: () => forget(id),
  });
}

function dismiss(id: string) {
  forget(id);
  toast.dismiss(id);
}

function review(trip: AdditionalTrip) {
  const s = useSim.getState();
  const hubId = tripHubId(trip);
  if (hubId) s.selectHub(hubId, "dispatch");
  else s.setTab("dispatch");
  useSim.getState().startPreview(trip.id);
}

function showProposal(trip: AdditionalTrip, paused: boolean, ctx: EffectContext) {
  const hubId = tripHubId(trip);
  const title = `New proposal: ${describeProposal(trip, tripRouteLabel(trip, ctx.queryClient), hubId ? hubName(hubId) : null)}`;
  show(`proposal:${trip.id}`, title, {
    description: paused ? PAUSED_FOR_REVIEW : undefined,
    duration: PROPOSAL_TOAST_MS,
    action: { label: "Review", onClick: () => review(trip) },
  });
  return title;
}

/** Performs the side effects for one batch of reducer effects. */
export function handleSimEffects(effects: readonly SimEffect[], ctx: EffectContext = {}): void {
  if (effects.length === 0) return;
  const now = ctx.now ?? Date.now();
  const store = useSim.getState();
  const batchPaused = effects.some((e) => e.kind === "auto-paused");
  const batchProposed = effects.some((e) => e.kind === "trip-proposed");

  for (const effect of effects) {
    switch (effect.kind) {
      case "trip-proposed": {
        const paused = batchPaused || now - recentAutoPauseAt <= AUTO_PAUSE_WINDOW_MS;
        const title = showProposal(effect.trip, paused, ctx);
        store.announce(paused ? `${title}. ${PAUSED_FOR_REVIEW}` : `${title}.`);
        recentProposal = { trip: effect.trip, at: now, paused };
        break;
      }
      case "auto-paused": {
        if (batchProposed) break;
        if (recentProposal && !recentProposal.paused && now - recentProposal.at <= AUTO_PAUSE_WINDOW_MS) {
          showProposal(recentProposal.trip, true, ctx);
          recentProposal = { ...recentProposal, paused: true };
          store.announce(PAUSED_FOR_REVIEW);
        } else {
          recentAutoPauseAt = now;
        }
        break;
      }
      case "event-new": {
        const { event } = effect;
        show(`event:${event.hub_id ?? event.source_location}`, eventToastText(event));
        break;
      }
      case "trip-expired": {
        const { trip } = effect;
        dismiss(`proposal:${trip.id}`);
        const hubId = tripHubId(trip);
        const text = describeProposal(trip, tripRouteLabel(trip, ctx.queryClient), hubId ? hubName(hubId) : null);
        show(`expired:${trip.id}`, "Proposal expired", { description: text.charAt(0).toUpperCase() + text.slice(1) });
        break;
      }
      case "system-error":
        toast.error("The simulation reported an error.", { id: "system-error", description: effect.message });
        break;
      case "reset":
        // A seek replaces every event and trip; toasts about the old state would point at nothing.
        for (const id of [...onScreen]) dismiss(id);
        recentProposal = null;
        recentAutoPauseAt = Number.NEGATIVE_INFINITY;
        break;
    }
  }
}
