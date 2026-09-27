// TanStack Query key factories. Time-dependent keys end with the sim hour (local_date + hour) and the epoch,
// so they refetch when the sim hour changes or a seek bumps the epoch (spec §11.2).

export const qk = {
  // static for the session (staleTime: Infinity)
  meta: () => ["meta"] as const,
  routes: (hubId: string | null, includeShape: boolean) => ["routes", hubId, includeShape] as const,
  route: (routeId: string) => ["route", routeId] as const,
  hubForecast: (hubId: string) => ["hub-forecast", hubId] as const,

  // time-dependent
  dispatchEvents: (hubId: string | null, localDate: string | null, hour: number | null, epoch: number) =>
    ["dispatch-events", hubId, localDate, hour, epoch] as const,
  trip: (tripId: string, epoch: number, status: string | null) => ["trip", tripId, epoch, status] as const,
};

/** Roots of every key that depends on the simulation clock; these are invalidated after a reset or reconnect. */
export const TIME_DEPENDENT_ROOTS: ReadonlySet<string> = new Set(["dispatch-events", "trip"]);

export function isTimeDependentKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && TIME_DEPENDENT_ROOTS.has(key[0]);
}
