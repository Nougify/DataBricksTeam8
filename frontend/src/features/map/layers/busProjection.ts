import type { AdditionalTrip, Bus, LatLon, MovementLeg } from "@/lib/api/schemas";

export interface ProjectedBusPosition {
  location: LatLon;
  heading_deg: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

function distanceM(start: readonly [number, number], end: readonly [number, number]): number {
  const lat1 = start[1] * DEG;
  const lat2 = end[1] * DEG;
  const dLat = lat2 - lat1;
  const dLon = (end[0] - start[0]) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function bearing(start: readonly [number, number], end: readonly [number, number]): number | null {
  if (start[0] === end[0] && start[1] === end[1]) return null;
  const lon1 = start[0] * DEG;
  const lat1 = start[1] * DEG;
  const lon2 = end[0] * DEG;
  const lat2 = end[1] * DEG;
  const dLon = lon2 - lon1;
  const x = Math.sin(dLon) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(x, y) / DEG + 360) % 360;
}

function interpolate(leg: MovementLeg, fraction: number): ProjectedBusPosition {
  const coordinates = leg.path.coordinates;
  const lengths = coordinates.slice(1).map((end, index) => distanceM(coordinates[index], end));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) {
    const [lon, lat] = coordinates.at(-1)!;
    return { location: { lon, lat }, heading_deg: null };
  }

  const target = Math.min(1, Math.max(0, fraction)) * total;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (length <= 0) continue;
    if (target <= traversed + length || index === lengths.length - 1) {
      const start = coordinates[index];
      const end = coordinates[index + 1];
      const local = Math.min(1, Math.max(0, (target - traversed) / length));
      return {
        location: {
          lon: start[0] + (end[0] - start[0]) * local,
          lat: start[1] + (end[1] - start[1]) * local,
        },
        heading_deg: bearing(start, end),
      };
    }
    traversed += length;
  }

  const [lon, lat] = coordinates.at(-1)!;
  return { location: { lon, lat }, heading_deg: null };
}

function projectLeg(leg: MovementLeg, start: string, end: string, atMs: number): ProjectedBusPosition {
  const startMs = Date.parse(start);
  const duration = Date.parse(end) - startMs;
  const fraction = duration <= 0 ? 1 : (atMs - startMs) / duration;
  return interpolate(leg, fraction);
}

/** Mirrors the backend's read-time projection without mutating authoritative bus state. */
export function projectBusPosition(bus: Bus, trip: AdditionalTrip | undefined, atMs: number): ProjectedBusPosition {
  const fallback = { location: bus.location, heading_deg: bus.heading_deg };
  if (!Number.isFinite(atMs) || !trip?.movement_plan || bus.assigned_trip_id !== trip.id) return fallback;

  const plan = trip.movement_plan;
  if (bus.status === "DEADHEADING") {
    return projectLeg(plan.deadhead, plan.dispatch_time, plan.estimated_arrival_time, atMs);
  }
  if (bus.status === "WAITING") return interpolate(plan.deadhead, 1);
  if (bus.status === "IN_SERVICE") {
    return projectLeg(plan.service, plan.service_departure_time, plan.estimated_completion_time, atMs);
  }
  if (bus.status === "RETURNING") {
    return projectLeg(plan.return_leg, plan.estimated_completion_time, plan.estimated_return_time, atMs);
  }
  return fallback;
}
