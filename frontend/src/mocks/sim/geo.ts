// Small geometry helpers for MockSim paths. Coordinates are GeoJSON [lon, lat]; distances are km.

export type Coord = [number, number];

const R_KM = 6371;
const RAD = Math.PI / 180;

export function distanceKm(a: Coord, b: Coord): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0-360). */
export function bearingDeg(a: Coord, b: Coord): number {
  const f1 = a[1] * RAD;
  const f2 = b[1] * RAD;
  const dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  const deg = Math.atan2(y, x) / RAD;
  return Math.round(((deg % 360) + 360) % 360);
}

export function pathLengthKm(coords: readonly Coord[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += distanceKm(coords[i - 1], coords[i]);
  return s;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;
export const roundCoord = (c: Coord): Coord => [round5(c[0]), round5(c[1])];

/** Drops consecutive duplicate points (a zero-length segment has no bearing). */
export function dedupe(coords: readonly Coord[]): Coord[] {
  const out: Coord[] = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || distanceKm(last, c) > 0.001) out.push(roundCoord(c));
  }
  return out;
}

export interface PointOnPath {
  coord: Coord;
  heading: number;
  /** Index of the segment the point is on (0-based; the point lies between coords[i] and coords[i+1]). */
  segment: number;
}

/** The point `km` along the path (clamped to its ends), with the heading of the segment it's on. */
export function pointAtKm(coords: readonly Coord[], km: number): PointOnPath {
  if (coords.length === 0) return { coord: [0, 0], heading: 0, segment: 0 };
  if (coords.length === 1) return { coord: coords[0], heading: 0, segment: 0 };
  let left = Math.max(0, km);
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = distanceKm(a, b);
    if (left <= d || i === coords.length - 1) {
      const t = d > 0 ? Math.min(1, left / d) : 1;
      return {
        coord: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        heading: bearingDeg(a, b),
        segment: i - 1,
      };
    }
    left -= d;
  }
  const n = coords.length;
  return { coord: coords[n - 1], heading: bearingDeg(coords[n - 2], coords[n - 1]), segment: n - 2 };
}

/** The point at fraction `f` (0-1) of the path length. */
export function pointAtFraction(coords: readonly Coord[], f: number): PointOnPath {
  return pointAtKm(coords, pathLengthKm(coords) * Math.min(1, Math.max(0, f)));
}

/** Index of the vertex nearest to `p`. */
export function nearestVertex(coords: readonly Coord[], p: Coord): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  coords.forEach((c, i) => {
    const d = distanceKm(c, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The part of `coords` from vertex `from` walking `km` towards the end (dir 1) or the start (dir -1),
 * ending at an interpolated point. The result starts at coords[from].
 */
export function walk(coords: readonly Coord[], from: number, dir: 1 | -1, km: number): Coord[] {
  const seq = dir === 1 ? coords.slice(from) : coords.slice(0, from + 1).reverse();
  const out: Coord[] = [seq[0]];
  let left = km;
  for (let i = 1; i < seq.length; i++) {
    const d = distanceKm(seq[i - 1], seq[i]);
    if (d >= left) {
      const t = d > 0 ? left / d : 1;
      out.push([seq[i - 1][0] + (seq[i][0] - seq[i - 1][0]) * t, seq[i - 1][1] + (seq[i][1] - seq[i - 1][1]) * t]);
      return dedupe(out);
    }
    out.push(seq[i]);
    left -= d;
  }
  return dedupe(out);
}
