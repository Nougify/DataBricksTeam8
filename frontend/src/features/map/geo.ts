// Small geometry helpers for map overlays. Pure functions, so layers can memoise their GeoJSON on inputs.
import type { Feature, FeatureCollection, Geometry, Polygon } from "geojson";

/** [longitude, latitude], the GeoJSON / MapLibre order. */
export type LngLatTuple = readonly [number, number];

/** South-west and north-east corners. */
export type Bounds = [[number, number], [number, number]];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = EARTH_RADIUS_M * DEG;

/** A closed ring approximating a circle of `radiusM` metres around `center`, as a GeoJSON polygon. */
export function circlePolygon(center: LngLatTuple, radiusM: number, steps = 64): Polygon {
  const [lon, lat] = center;
  const dLat = radiusM / M_PER_DEG;
  const dLon = radiusM / (M_PER_DEG * Math.cos(lat * DEG));
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

/** Bounding box of `points`, grown so it reaches at least `minRadiusM` from its centre in each direction. */
export function boundsOf(points: readonly LngLatTuple[], minRadiusM = 0): Bounds | null {
  if (points.length === 0) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    w = Math.min(w, lon);
    e = Math.max(e, lon);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  if (!Number.isFinite(w)) return null;
  if (minRadiusM > 0) {
    const cLon = (w + e) / 2;
    const cLat = (s + n) / 2;
    const dLat = minRadiusM / M_PER_DEG;
    const dLon = minRadiusM / (M_PER_DEG * Math.cos(cLat * DEG));
    w = Math.min(w, cLon - dLon);
    e = Math.max(e, cLon + dLon);
    s = Math.min(s, cLat - dLat);
    n = Math.max(n, cLat + dLat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

export const featureCollection = <G extends Geometry, P>(
  features: Feature<G, P>[],
): FeatureCollection<G, P> => ({ type: "FeatureCollection", features });
