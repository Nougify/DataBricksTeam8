// TanStack Query hooks (spec §11.2).
// - Static data never goes stale in a session (staleTime: Infinity).
// - Time-dependent data keys on the throttled sim hour + epoch from useSimHourKey(); pass `visible: false`
//   for views that aren't on screen so they don't refetch at 3600x.
// - Mutations push returned Clocks and trips into the live store; the WebSocket confirms them later.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSim } from "@/lib/live/store";
import { useSimHourKey } from "@/lib/live/timeKey";
import { resyncNow } from "@/lib/live/connection";
import { isApiError } from "./client";
import * as api from "./endpoints";
import { qk } from "./queryKeys";
import type { AdditionalTrip, Clock, DayType, OriginsBasis } from "./schemas";

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const;
/** Time-dependent entries pile up quickly at high speed; drop unused ones after a minute. */
const TIME_DEPENDENT_GC_MS = 60_000;

interface TimeOpts {
  /** False when the view using the data isn't on screen (throttling at 3600x). Default true. */
  visible?: boolean;
}

/**
 * Keeps showing the previous sim hour's data while the next one loads, but only when the other inputs
 * (the first `inputs` parts of the key, e.g. root + hub + horizon) are unchanged, so one hub's numbers
 * never stand in for another's.
 */
function keepWhileSameInputs(key: readonly unknown[], inputs: number) {
  return <T>(previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): T | undefined => {
    if (!previousQuery) return undefined;
    for (let i = 0; i < inputs; i++) if (previousQuery.queryKey[i] !== key[i]) return undefined;
    return previous;
  };
}

// ---------- static ----------

export const useMeta = () => useQuery({ queryKey: qk.meta(), queryFn: ({ signal }) => api.getMeta({ signal }), ...STATIC });

export const useHubs = () => useQuery({ queryKey: qk.hubs(), queryFn: ({ signal }) => api.getHubs({ signal }), ...STATIC });

export const useFindings = () =>
  useQuery({ queryKey: qk.findings(), queryFn: ({ signal }) => api.getFindings({ signal }), ...STATIC });

export const useBacktest = () =>
  useQuery({ queryKey: qk.backtest(), queryFn: ({ signal }) => api.getBacktest({ signal }), ...STATIC });

export const useValidation = () =>
  useQuery({ queryKey: qk.validation(), queryFn: ({ signal }) => api.getValidation({ signal }), ...STATIC });

export function useTimeline(params?: { from?: string; to?: string }) {
  const from = params?.from ?? null;
  const to = params?.to ?? null;
  return useQuery({
    queryKey: qk.timeline(from, to),
    queryFn: ({ signal }) => api.getTimeline({ from: from ?? undefined, to: to ?? undefined }, { signal }),
    ...STATIC,
  });
}

export function useEvents(params?: { from?: string; to?: string; hubId?: string | null }) {
  const from = params?.from ?? null;
  const to = params?.to ?? null;
  const hubId = params?.hubId ?? null;
  return useQuery({
    queryKey: qk.events(from, to, hubId),
    queryFn: ({ signal }) =>
      api.getEvents({ from: from ?? undefined, to: to ?? undefined, hub_id: hubId ?? undefined }, { signal }),
    ...STATIC,
  });
}

export const useHubOverview = (hubId: string | null) =>
  useQuery({
    queryKey: qk.overview(hubId ?? ""),
    queryFn: ({ signal }) => api.getHubOverview(hubId!, { signal }),
    enabled: !!hubId,
    ...STATIC,
  });

export const useRouteCrowding = (hubId: string | null) =>
  useQuery({
    queryKey: qk.routeCrowding(hubId ?? ""),
    queryFn: ({ signal }) => api.getRouteCrowding(hubId!, { signal }),
    enabled: !!hubId,
    ...STATIC,
  });

export const useRecommendations = (hubId: string | null) =>
  useQuery({
    queryKey: qk.recommendations(hubId ?? ""),
    queryFn: ({ signal }) => api.getRecommendations(hubId!, { signal }),
    enabled: !!hubId,
    ...STATIC,
  });

export const useHourlyProfile = (hubId: string | null, dayType: DayType) =>
  useQuery({
    queryKey: qk.hourlyProfile(hubId ?? "", dayType),
    queryFn: ({ signal }) => api.getHourlyProfile(hubId!, dayType, { signal }),
    enabled: !!hubId,
    ...STATIC,
  });

/** Routes serving a hub (or all routes when hubId is null). Shapes are heavy: ask for them only for the map. */
export function useRoutes(hubId: string | null, includeShape = false) {
  return useQuery({
    queryKey: qk.routes(hubId, includeShape),
    queryFn: ({ signal }) =>
      api.getRoutes({ hub_id: hubId ?? undefined, include_shape: includeShape }, { signal }),
    ...STATIC,
  });
}

// ---------- time-dependent ----------

/** Forecast chart data. history_hours = max(6, horizon). */
export function useForecast(hubId: string | null, horizon: number, opts?: TimeOpts) {
  const key = useSimHourKey(opts);
  const queryKey = qk.forecast(hubId ?? "", horizon, key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api.getForecast(
        hubId!,
        { at: key.at ?? undefined, horizon_hours: horizon, history_hours: Math.max(6, horizon) },
        { signal },
      ),
    enabled: !!hubId && key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 3),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

export function useOrigins(hubId: string | null, basis: OriginsBasis, opts?: TimeOpts) {
  const key = useSimHourKey(opts);
  const queryKey = qk.origins(hubId ?? "", basis, key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getOrigins(hubId!, { at: key.at ?? undefined, basis }, { signal }),
    enabled: !!hubId && key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 3),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

export function useLateNight(hubId: string | null, opts?: TimeOpts) {
  const key = useSimHourKey(opts);
  const queryKey = qk.lateNight(hubId ?? "", key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getLateNight(hubId!, { at: key.at ?? undefined }, { signal }),
    enabled: !!hubId && key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 2),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

/** Need vs spare routes for a hub (or network-wide when hubId is null). */
export function useRouteLoad(hubId: string | null, opts?: TimeOpts) {
  const key = useSimHourKey(opts);
  const queryKey = qk.routeLoad(hubId, key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getRouteLoad({ at: key.at ?? undefined, hub_id: hubId ?? undefined }, { signal }),
    enabled: key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 2),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

/** Retired analytical hub-status endpoint. Operational demand state comes from dispatch events. */
export function useHubStatus(hubId: string | null, opts?: TimeOpts) {
  const key = useSimHourKey(opts);
  const queryKey = qk.hubStatus(hubId ?? "", key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getHubStatus(hubId!, { at: key.at ?? undefined }, { signal }),
    enabled: !!hubId && key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 2),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

/** Route stops, shape and scheduled departures. Without a window the backend uses the sim time. */
export function useRouteDetail(
  routeId: string | null,
  range?: { date?: string; from?: string; to?: string },
  opts?: TimeOpts,
) {
  const key = useSimHourKey(opts);
  const queryKey = qk.route(routeId ?? "", range ?? null, key.localDate, key.hour, key.epoch);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getRoute(routeId!, range, { signal }),
    enabled: !!routeId && key.at !== null,
    placeholderData: keepWhileSameInputs(queryKey, 2),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

/** Trip detail for Preview and the trip drawer; refetches when the trip's status changes. */
export function useTripDetail(tripId: string | null) {
  const epoch = useSim((s) => s.epoch);
  const status = useSim((s) => (tripId ? (s.trips[tripId]?.status ?? null) : null));
  const queryKey = qk.tripDetail(tripId ?? "", epoch, status);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.getTripDetail(tripId!, { signal }),
    enabled: !!tripId,
    placeholderData: keepWhileSameInputs(queryKey, 2),
    gcTime: TIME_DEPENDENT_GC_MS,
  });
}

// ---------- mutations ----------

const applyClock = (clock: Clock) => useSim.getState().setClockOptimistic(clock);

export const usePause = () => useMutation({ mutationFn: api.pauseSimulation, onSuccess: applyClock });

export const useResume = () => useMutation({ mutationFn: api.resumeSimulation, onSuccess: applyClock });

export const useSetSpeed = () =>
  useMutation({ mutationFn: (speed: number) => api.setSimulationSpeed(speed), onSuccess: applyClock });

export const useUpdateSettings = () =>
  useMutation({
    mutationFn: (settings: { auto_pause_on_proposal: boolean }) => api.updateSimulationSettings(settings),
    onSuccess: applyClock,
  });

/**
 * Seek. The returned Clock is shown right away and `pendingSeek` holds until the WebSocket's `system.reset`
 * brings the new /state (the connection refetches it; don't refetch here). Any preview is closed.
 */
export const useSeek = () =>
  useMutation({
    mutationFn: (currentTime: string) => api.seekSimulation(currentTime),
    onSuccess: (clock) => {
      const s = useSim.getState();
      s.setClockOptimistic(clock);
      s.exitPreview();
      // No socket means no system.reset is coming; fetch the new state directly.
      if (s.connection !== "live") resyncNow();
    },
  });

/** Messages for the 409 codes on approve/reject (spec §9.3). */
export const TRIP_CONFLICT_MESSAGES: Record<string, string> = {
  TRIP_EXPIRED: "This proposal expired before approval.",
  TRIP_REJECTED: "Already rejected.",
  STALE_EPOCH: "The simulation moved. Refreshing…",
  TRIP_NOT_PROPOSED: "This trip changed state. Showing latest.",
};

async function tripDecision(run: () => Promise<AdditionalTrip>): Promise<AdditionalTrip> {
  try {
    const trip = await run();
    useSim.getState().upsertTrip(trip);
    return trip;
  } catch (err) {
    if (isApiError(err) && err.status === 409) {
      if (err.trip) useSim.getState().upsertTrip(err.trip);
      if (err.code === "STALE_EPOCH") resyncNow();
    }
    // Rethrown so the caller can show TRIP_CONFLICT_MESSAGES[err.code].
    throw err;
  }
}

export const useApproveTrip = () =>
  useMutation({
    mutationFn: ({ tripId }: { tripId: string }) => tripDecision(() => api.approveTrip(tripId)),
  });

export const useRejectTrip = () =>
  useMutation({
    mutationFn: ({ tripId }: { tripId: string; reason?: string }) => tripDecision(() => api.rejectTrip(tripId)),
  });
