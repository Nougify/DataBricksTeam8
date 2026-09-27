// TanStack Query key factories. Time-dependent keys end with the sim hour (local_date + hour) and the epoch,
// so they refetch when the sim hour changes or a seek bumps the epoch (spec §11.2).
import type { DayType, OriginsBasis } from "./schemas";

export const qk = {
  // static (staleTime: Infinity)
  meta: () => ["meta"] as const,
  hubs: () => ["hubs"] as const,
  findings: () => ["findings"] as const,
  backtest: () => ["backtest"] as const,
  validation: () => ["validation"] as const,
  timeline: (from: string | null, to: string | null) => ["timeline", from, to] as const,
  events: (from: string | null, to: string | null, hubId: string | null) => ["events", from, to, hubId] as const,
  overview: (hubId: string) => ["overview", hubId] as const,
  routeCrowding: (hubId: string) => ["route-crowding", hubId] as const,
  recommendations: (hubId: string) => ["recommendations", hubId] as const,
  hourlyProfile: (hubId: string, dayType: DayType) => ["hourly-profile", hubId, dayType] as const,
  routes: (hubId: string | null, includeShape: boolean) => ["routes", hubId, includeShape] as const,

  // time-dependent
  forecast: (hubId: string, horizon: number, localDate: string | null, hour: number | null, epoch: number) =>
    ["forecast", hubId, horizon, localDate, hour, epoch] as const,
  origins: (hubId: string, basis: OriginsBasis, localDate: string | null, hour: number | null, epoch: number) =>
    ["origins", hubId, basis, localDate, hour, epoch] as const,
  lateNight: (hubId: string, localDate: string | null, hour: number | null, epoch: number) =>
    ["late-night", hubId, localDate, hour, epoch] as const,
  routeLoad: (hubId: string | null, localDate: string | null, hour: number | null, epoch: number) =>
    ["route-load", hubId, localDate, hour, epoch] as const,
  hubStatus: (hubId: string, localDate: string | null, hour: number | null, epoch: number) =>
    ["hub-status", hubId, localDate, hour, epoch] as const,
  route: (
    routeId: string,
    range: { date?: string; from?: string; to?: string } | null,
    localDate: string | null,
    hour: number | null,
    epoch: number,
  ) => ["route", routeId, range, localDate, hour, epoch] as const,
  tripDetail: (tripId: string, epoch: number, status: string | null) =>
    ["trip-detail", tripId, epoch, status] as const,
};

/** Roots of every key that depends on the simulation clock; these are invalidated after a reset or reconnect. */
export const TIME_DEPENDENT_ROOTS: ReadonlySet<string> = new Set([
  "forecast",
  "origins",
  "late-night",
  "route-load",
  "hub-status",
  "route",
  "trip-detail",
]);

export function isTimeDependentKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && TIME_DEPENDENT_ROOTS.has(key[0]);
}
