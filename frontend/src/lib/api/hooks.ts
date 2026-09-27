// TanStack Query hooks (spec §11.2) for the v3 backend plus the bundled analytics snapshots.
// - Static data never goes stale in a session (staleTime: Infinity). That includes the bundled snapshots in
//   src/data, which are the same in mock and real mode.
// - Live state (clock, dispatch events, trips, buses) comes from the live store, not from queries.
// - Mutations push returned Clocks and trips into the live store; the WebSocket confirms them later.
import { useMutation, useQuery } from "@tanstack/react-query";
import { loadHubForecast } from "@/data/forecast";
import { useSim } from "@/lib/live/store";
import { resyncNow } from "@/lib/live/connection";
import { isApiError } from "./client";
import * as api from "./endpoints";
import { qk } from "./queryKeys";
import type { AdditionalTrip, Clock, Speed } from "./schemas";

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const;

// ---------- static ----------

export const useMeta = () => useQuery({ queryKey: qk.meta(), queryFn: ({ signal }) => api.getMeta({ signal }), ...STATIC });

/** Routes serving a hub (or all routes when hubId is null). Shapes are heavy: ask for them only for the map. */
export function useRoutes(hubId: string | null, includeShape = false) {
  return useQuery({
    queryKey: qk.routes(hubId, includeShape),
    queryFn: ({ signal }) => api.getRoutes({ hub_id: hubId ?? undefined, include_shape: includeShape }, { signal }),
    ...STATIC,
  });
}

export const useRoute = (routeId: string | null) =>
  useQuery({
    queryKey: qk.route(routeId ?? ""),
    queryFn: ({ signal }) => api.getRoute(routeId!, { signal }),
    enabled: !!routeId,
    ...STATIC,
  });

/** One hub's bundled hourly forecast snapshot (model.surge_forecast_hourly), loaded on demand. */
export const useHubForecast = (hubId: string | null) =>
  useQuery({
    queryKey: qk.hubForecast(hubId ?? ""),
    queryFn: () => loadHubForecast(hubId!),
    enabled: !!hubId,
    ...STATIC,
  });

// ---------- time-dependent ----------

/** One trip over REST, e.g. to refresh a card after a 409. Refetches when its status or the epoch changes. */
export function useTrip(tripId: string | null) {
  const epoch = useSim((s) => s.epoch);
  const status = useSim((s) => (tripId ? (s.trips[tripId]?.status ?? null) : null));
  return useQuery({
    queryKey: qk.trip(tripId ?? "", epoch, status),
    queryFn: ({ signal }) => api.getTrip(tripId!, { signal }),
    enabled: !!tripId,
    gcTime: 60_000,
  });
}

// ---------- mutations ----------

const applyClock = (clock: Clock) => useSim.getState().setClockOptimistic(clock);

export const usePause = () => useMutation({ mutationFn: api.pauseClock, onSuccess: applyClock });

export const useResume = () => useMutation({ mutationFn: api.resumeClock, onSuccess: applyClock });

export const useSetSpeed = () =>
  useMutation({ mutationFn: (speed: Speed) => api.setClockSpeed(speed), onSuccess: applyClock });

/**
 * Seek. The returned Clock is shown right away and `pendingSeek` holds until the WebSocket's `system.reset`
 * brings the new /state (the connection refetches it; don't refetch here). Any preview is closed.
 */
export const useSeek = () =>
  useMutation({
    mutationFn: (time: string) => api.seekClock(time),
    onSuccess: (clock) => {
      const s = useSim.getState();
      s.setClockOptimistic(clock);
      s.exitPreview();
      // No socket means no system.reset is coming; fetch the new state directly.
      if (s.connection !== "live") resyncNow();
    },
  });

/**
 * Approve or reject. On a 409 the backend sends no trip, so the trip is refetched and the store updated, then
 * the error is rethrown for the caller to show tripConflictMessage(err).
 */
async function tripDecision(tripId: string, run: () => Promise<AdditionalTrip>): Promise<AdditionalTrip> {
  try {
    const trip = await run();
    useSim.getState().upsertTrip(trip);
    return trip;
  } catch (err) {
    if (isApiError(err) && err.status === 409) {
      try {
        useSim.getState().upsertTrip(await api.getTrip(tripId));
      } catch {
        resyncNow();
      }
    }
    throw err;
  }
}

export const useApproveTrip = () =>
  useMutation({ mutationFn: ({ tripId }: { tripId: string }) => tripDecision(tripId, () => api.approveTrip(tripId)) });

export const useRejectTrip = () =>
  useMutation({ mutationFn: ({ tripId }: { tripId: string }) => tripDecision(tripId, () => api.rejectTrip(tripId)) });
