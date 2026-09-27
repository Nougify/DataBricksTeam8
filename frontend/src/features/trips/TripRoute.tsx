"use client";

import { RouteBullet } from "@/components/RouteBullet";
import { useRoutes } from "@/lib/api/hooks";
import type { AdditionalTrip } from "@/lib/api/schemas";

/** The trip's route as a plate (GET /routes, cached for the session), falling back to the feed's route key. */
export function TripRoute({ trip, dense = true }: { trip: Pick<AdditionalTrip, "route_id" | "source_route">; dense?: boolean }) {
  const routes = useRoutes(null);
  const route = routes.data?.find((r) => r.route_id === trip.route_id);
  return (
    <RouteBullet
      dense={dense}
      route={route ?? { short_name: trip.source_route ?? trip.route_id, long_name: null, color: null, text_color: null }}
    />
  );
}
