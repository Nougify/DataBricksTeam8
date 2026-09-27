import { describe, expect, it } from "vitest";
import { TRIP } from "@/lib/live/__tests__/fixtures";
import { tripFitTarget } from "./camera";

const provenance = { provider: "test", is_approximation: false, method: "fixture", speed_kph: null };
const leg = (kind: "DEADHEAD" | "SERVICE" | "RETURN", coordinates: [number, number][]) => ({
  kind,
  path: { type: "LineString" as const, coordinates },
  distance_m: 1000,
  duration_seconds: 60,
  provenance,
});

describe("tripFitTarget", () => {
  it("frames every leg of the previewed trip's movement plan", () => {
    const plan = {
      deadhead: leg("DEADHEAD", [[-123.1, 49.2], [-123.2, 49.25]]),
      service: leg("SERVICE", [[-123.2, 49.25], [-123.25, 49.26]]),
      return_leg: leg("RETURN", [[-123.25, 49.26], [-123.1, 49.2]]),
    };
    const target = tripFitTarget({ ...TRIP, movement_plan: plan as never });
    expect(target?.key).toBe(`preview:${TRIP.id}`);
    expect(target?.points).toHaveLength(6);
    expect(target?.points).toContainEqual([-123.25, 49.26]);
  });

  it("leaves the camera alone when the trip has no movement plan yet", () => {
    expect(tripFitTarget({ ...TRIP, movement_plan: null })).toBeNull();
  });
});
