// Turns reducer effects into toasts and aria-live announcements (spec §11.3).
// Toast ids are stable per kind + entity, so repeats update in place instead of stacking, and at most
// three toasts are on screen at once (the oldest is dismissed first).
import { toast } from "sonner";
import type { QueryClient } from "@tanstack/react-query";
import type { AdditionalTrip, Hub, Surge } from "@/lib/api/schemas";
import { qk } from "@/lib/api/queryKeys";
import { fmtIndex, fmtTime } from "@/lib/format";
import type { SimEffect } from "./reducer";
import { useSim } from "./store";

const MAX_TOASTS = 3;
/** An auto-pause this close to a proposal (either order) is reported on the proposal's toast. */
const AUTO_PAUSE_WINDOW_MS = 300;
const PROPOSAL_TOAST_MS = 12_000;

export const PAUSED_FOR_REVIEW = "Simulation paused for review.";

const FALLBACK_HUB_NAMES: Record<string, string> = {
  ubc: "UBC",
  waterfront: "Waterfront Station",
  "park-royal": "Park Royal",
};

export interface EffectContext {
  /** Used to read hub display names from the /hubs cache. */
  queryClient?: QueryClient;
  /** Wall ms; injectable for tests. */
  now?: number;
}

export function hubDisplayName(hubId: string, queryClient?: QueryClient): string {
  const hubs = queryClient?.getQueryData<Hub[]>(qk.hubs());
  return hubs?.find((h) => h.id === hubId)?.name ?? FALLBACK_HUB_NAMES[hubId] ?? hubId;
}

/** "bus from route 25 → 99 at UBC" (or "bus from depot → R2 at Park Royal"). */
export function describeProposal(trip: AdditionalTrip, hubName: string | null): string {
  const from = trip.donor_route ? `bus from route ${trip.donor_route.short_name}` : "bus from depot";
  return `${from} → ${trip.route.short_name}${hubName ? ` at ${hubName}` : ""}`;
}

/** "From depot: North Vancouver Transit Centre" when the bus comes from a depot, else null. */
export function depotLine(trip: AdditionalTrip, depotName: string | null | undefined): string | null {
  if (trip.donor_route) return null;
  return `From depot: ${depotName ?? "unknown depot"}`;
}

export function surgeToastText(surge: Surge, locationName: string): string {
  return `Surge forecast at ${locationName} ${fmtTime(surge.predicted_window.start)}, ${fmtIndex(surge.magnitude.surge_index)}`;
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

function hubName(hubId: string | null, ctx: EffectContext): string | null {
  return hubId ? hubDisplayName(hubId, ctx.queryClient) : null;
}

function review(trip: AdditionalTrip) {
  const s = useSim.getState();
  if (trip.hub_id) s.selectHub(trip.hub_id, "dispatch");
  else s.setTab("dispatch");
  useSim.getState().startPreview(trip.id);
}

function showProposal(trip: AdditionalTrip, paused: boolean, ctx: EffectContext) {
  const title = `New proposal: ${describeProposal(trip, hubName(trip.hub_id, ctx))}`;
  const depot = depotLine(trip, useSim.getState().buses[trip.bus.id]?.source.depot_name);
  const description = [depot && `${depot}.`, paused ? PAUSED_FOR_REVIEW : null].filter(Boolean).join(" ");
  show(`proposal:${trip.id}`, title, {
    description: description || undefined,
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
      case "surge-new": {
        const { surge } = effect;
        const where = surge.hub_id ? hubDisplayName(surge.hub_id, ctx.queryClient) : surge.location_name;
        show(`surge:${surge.id}`, surgeToastText(surge, where));
        break;
      }
      case "trip-expired": {
        const { trip } = effect;
        dismiss(`proposal:${trip.id}`);
        const description = describeProposal(trip, hubName(trip.hub_id, ctx));
        show(`expired:${trip.id}`, "Proposal expired", {
          description: description.charAt(0).toUpperCase() + description.slice(1),
        });
        break;
      }
      case "reset":
        // A seek replaces every trip and surge; toasts about the old state would point at nothing.
        for (const id of [...onScreen]) dismiss(id);
        recentProposal = null;
        recentAutoPauseAt = Number.NEGATIVE_INFINITY;
        break;
    }
  }
}
