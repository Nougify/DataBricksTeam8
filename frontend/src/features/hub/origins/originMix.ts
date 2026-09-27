// Where the pings at a hub come from (spec §9.2, DECISIONS.md "2b answers"). Two bases, both bundled:
//   - "typical": origin_hourly, average pings per day by origin for the sim's day type and last full hour;
//   - "all": origins.json (gold_origin_access), the whole dataset.
// Shares follow gold_origin_access: share_pct is over every ping, share_of_local_pct over regional pings only
// (one-seat ride + transfer required; LOCAL and VISITOR are left out of it).
import { originName, type SeedAccessType, type SeedOriginRow } from "@/data/index";
import type { DispatchEvent } from "@/lib/api/schemas";

export interface OriginMixRow {
  origin: string;
  region: string;
  location: { lat: number; lon: number } | null;
  pings: number;
  share_pct: number;
  /** Null for LOCAL and VISITOR rows. */
  share_of_local_pct: number | null;
  access_type: SeedAccessType;
  direct_lines: string[];
}

export interface OriginMix {
  /** Regional origins (one-seat ride or transfer required), most pings first. */
  regional: OriginMixRow[];
  /** The hub's own area. */
  local: OriginMixRow | null;
  /** Out-of-region origins, most pings first. */
  visitors: OriginMixRow[];
  totalPings: number;
  regionalPings: number;
  /** Σ share_of_local_pct over transfer-required rows: "X% of regional pings come from areas with no one-seat ride". */
  transferSharePct: number;
  lowSample: boolean;
}

/** Below this many regional pings, shares are flagged as noisy ("Few pings in this hour"). */
export const LOW_SAMPLE_PINGS = 50;

const REGIONAL: ReadonlySet<SeedAccessType> = new Set(["ONE_SEAT_RIDE", "TRANSFER_REQUIRED"]);

/** Builds the mix from a hub's 36 dim_origin rows and a pings value per origin (missing = 0). */
export function buildOriginMix(seeds: readonly SeedOriginRow[], pingsFor: (origin: string) => number): OriginMix {
  const base = seeds.map((s) => ({ seed: s, pings: Math.max(0, pingsFor(s.origin)) }));
  const totalPings = base.reduce((a, b) => a + b.pings, 0);
  const regionalPings = base.filter((b) => REGIONAL.has(b.seed.access_type)).reduce((a, b) => a + b.pings, 0);
  const rows = base.map(({ seed, pings }): OriginMixRow => ({
    origin: seed.origin,
    region: seed.region,
    location: seed.lat !== null && seed.lon !== null ? { lat: seed.lat, lon: seed.lon } : null,
    pings,
    share_pct: totalPings > 0 ? (pings / totalPings) * 100 : 0,
    share_of_local_pct: REGIONAL.has(seed.access_type) ? (regionalPings > 0 ? (pings / regionalPings) * 100 : 0) : null,
    access_type: seed.access_type,
    direct_lines: seed.direct_lines,
  }));
  const byPings = (a: OriginMixRow, b: OriginMixRow) => b.pings - a.pings || a.origin.localeCompare(b.origin);
  const regional = rows.filter((r) => REGIONAL.has(r.access_type)).sort(byPings);
  const transferSharePct = regional
    .filter((r) => r.access_type === "TRANSFER_REQUIRED")
    .reduce((a, r) => a + (r.share_of_local_pct ?? 0), 0);
  return {
    regional,
    local: rows.find((r) => r.access_type === "LOCAL") ?? null,
    visitors: rows.filter((r) => r.access_type === "VISITOR").sort(byPings),
    totalPings,
    regionalPings,
    transferSharePct,
    lowSample: regionalPings < LOW_SAMPLE_PINGS,
  };
}

export interface SurgeDestination {
  /** dim_origin spelling when the feed name matches, else the feed's own text. */
  name: string;
  matched: boolean;
  /** destination_share, percentage points. */
  share: number;
  /** The recommended source route key ("49", "R4") and its resolved route id, if any. */
  route: string;
  route_id: string | null;
}

/**
 * "Where the surge crowd is headed" (DECISIONS.md "Origins"): the recommendations of an episode's peak event, by
 * priority, one row per destination. Feed destinations match dim_origin case- and space-insensitively.
 */
export function surgeDestinations(event: DispatchEvent | null, limit = 6): SurgeDestination[] {
  if (!event) return [];
  const recs = [...event.recommendations].sort((a, b) => b.priority_score - a.priority_score);
  const seen = new Set<string>();
  const out: SurgeDestination[] = [];
  for (const r of recs) {
    const matchedName = originName(r.destination);
    const name = matchedName ?? r.destination;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, matched: matchedName !== undefined, share: r.destination_share, route: r.source_route, route_id: r.route_id });
    if (out.length >= limit) break;
  }
  return out;
}
