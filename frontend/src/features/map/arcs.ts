// Origin arcs (spec §7.3 layer 3, DESIGN.md §8.2): a quadratic Bézier from the origin to the hub, 48 points, with the
// control point 0.2 × chord to the left of travel so every arc bows the same way. Computed in a local equirectangular
// plane (longitude scaled by cos(latitude)), so the bow looks the same whatever the arc's direction.
import type { LngLatTuple } from "./geo";

export const ARC_POINTS = 48;
export const ARC_BOW = 0.2;

export function arcCoordinates(from: LngLatTuple, to: LngLatTuple, points = ARC_POINTS, bow = ARC_BOW): [number, number][] {
  const k = Math.cos((((from[1] + to[1]) / 2) * Math.PI) / 180);
  const x0 = from[0] * k;
  const y0 = from[1];
  const x2 = to[0] * k;
  const y2 = to[1];
  const dx = x2 - x0;
  const dy = y2 - y0;
  // Left of travel: rotate the chord 90° anticlockwise.
  const cx = (x0 + x2) / 2 - dy * bow;
  const cy = (y0 + y2) / 2 + dx * bow;
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    out.push([(a * x0 + b * cx + c * x2) / k, a * y0 + b * cy + c * y2]);
  }
  return out;
}

/** Arc width in px from share_of_local_pct: 1 + 9 · clamp(share / 15, 0, 1). */
export const arcWidth = (sharePct: number) => 1 + 9 * Math.min(1, Math.max(0, sharePct / 15));

/** Bubble radius in px: 3 + 19 · √(pings / max pings). */
export const bubbleRadius = (pings: number, maxPings: number) => 3 + 19 * Math.sqrt(maxPings > 0 ? Math.max(0, pings) / maxPings : 0);
