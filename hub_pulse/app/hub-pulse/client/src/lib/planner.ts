export type HourStatus = 'Underserved' | 'Overserved' | 'Balanced' | 'No service';

export interface HourInput {
  hour: number;
  visits: number;
  departures: number;
  /** Peak load factor (% of capacity) of the busiest line serving the hub in this hour's TSPR period; 0 if unknown. */
  peakLoad: number;
}

export interface HourResult {
  hour: number;
  visits: number;
  baseDepartures: number;
  scenarioDepartures: number;
  demandShare: number;
  baseShare: number;
  scenarioShare: number;
  baseGap: number | null;
  scenarioGap: number | null;
  baseStatus: HourStatus;
  scenarioStatus: HourStatus;
  /** Fewest departures that keep the busiest line at or under CROWDED_LOAD_PCT. */
  minDepartures: number;
  baseLoad: number | null;
  /** Projected peak load if the same riders spread over the scenario's departures. */
  scenarioLoad: number | null;
}

export interface PlanMetrics {
  /** Share of departures that would have to move for service to mirror demand (0-1). */
  mismatch: number;
  /** Share of daily visits that fall in underserved hours (0-1). */
  visitsUnderserved: number;
  underservedHours: number;
  totalDepartures: number;
  /** Hours whose projected busiest-line load exceeds CROWDED_LOAD_PCT. */
  overCapacityHours: number;
}

export const UNDERSERVED_GAP = 1.5;
export const OVERSERVED_GAP = 0.67;
export const CROWDED_LOAD_PCT = 85;
const MIN_DEMAND_FOR_NO_SERVICE = 0.01;
const MIN_DEPARTURES_AFTER_SHIFT = 2;

// Mirrors the status rule in gold_hub_gap_hourly so client and warehouse agree.
export function classify(demandShare: number, supplyShare: number, departures: number): HourStatus {
  if (departures === 0) return demandShare > MIN_DEMAND_FOR_NO_SERVICE ? 'No service' : 'Balanced';
  const gap = demandShare / supplyShare;
  if (gap > UNDERSERVED_GAP) return 'Underserved';
  if (gap < OVERSERVED_GAP) return 'Overserved';
  return 'Balanced';
}

/** Capacity-safe floor: removing buses concentrates the same riders on fewer vehicles. */
export function minDepartures(h: HourInput): number {
  const byLoad = h.peakLoad > 0 ? Math.ceil((h.departures * h.peakLoad) / CROWDED_LOAD_PCT) : 0;
  return Math.min(h.departures, Math.max(byLoad, MIN_DEPARTURES_AFTER_SHIFT));
}

export function projectedLoad(h: HourInput, departures: number): number | null {
  if (h.peakLoad <= 0 || h.departures === 0) return null;
  if (departures === 0) return Infinity;
  return (h.peakLoad * h.departures) / departures;
}

const isShort = (s: HourStatus) => s === 'Underserved' || s === 'No service';

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function demandShares(hours: HourInput[]): number[] {
  const total = sum(hours.map((h) => h.visits));
  return hours.map((h) => (total > 0 ? h.visits / total : 0));
}

export function evaluate(hours: HourInput[], deltas: number[]): { rows: HourResult[]; base: PlanMetrics; scenario: PlanMetrics } {
  const demand = demandShares(hours);
  const base = hours.map((h) => h.departures);
  const scen = hours.map((h, i) => Math.max(0, h.departures + (deltas[i] ?? 0)));
  const baseTotal = sum(base);
  const scenTotal = sum(scen);

  const rows: HourResult[] = hours.map((h, i) => {
    const baseShare = baseTotal > 0 ? base[i] / baseTotal : 0;
    const scenarioShare = scenTotal > 0 ? scen[i] / scenTotal : 0;
    return {
      hour: h.hour,
      visits: h.visits,
      baseDepartures: base[i],
      scenarioDepartures: scen[i],
      demandShare: demand[i],
      baseShare,
      scenarioShare,
      baseGap: base[i] > 0 ? demand[i] / baseShare : null,
      scenarioGap: scen[i] > 0 ? demand[i] / scenarioShare : null,
      baseStatus: classify(demand[i], baseShare, base[i]),
      scenarioStatus: classify(demand[i], scenarioShare, scen[i]),
      minDepartures: minDepartures(h),
      baseLoad: projectedLoad(h, base[i]),
      scenarioLoad: projectedLoad(h, scen[i]),
    };
  });

  const summarize = (deps: number[], pick: (r: HourResult) => { status: HourStatus; load: number | null }): PlanMetrics => {
    const total = sum(deps);
    const supply = deps.map((d) => (total > 0 ? d / total : 0));
    const picked = rows.map(pick);
    return {
      mismatch: 0.5 * sum(demand.map((p, i) => Math.abs(p - supply[i]))),
      visitsUnderserved: sum(demand.filter((_, i) => isShort(picked[i].status))),
      underservedHours: picked.filter((x) => isShort(x.status)).length,
      totalDepartures: total,
      overCapacityHours: picked.filter((x) => x.load !== null && x.load > CROWDED_LOAD_PCT).length,
    };
  };

  return {
    rows,
    base: summarize(base, (r) => ({ status: r.baseStatus, load: r.baseLoad })),
    scenario: summarize(scen, (r) => ({ status: r.scenarioStatus, load: r.scenarioLoad })),
  };
}

function shortfalls(demand: number[], departures: number[]): number[] {
  const total = sum(departures);
  return demand.map((p, i) => p - (total > 0 ? departures[i] / total : 0));
}

function argBest(values: number[], eligible: (i: number) => boolean, better: (a: number, b: number) => boolean): number {
  let best = -1;
  values.forEach((v, i) => {
    if (eligible(i) && (best < 0 || better(v, values[best]))) best = i;
  });
  return best;
}

/** Greedily add `budget` departures, one at a time, to the hour whose share of service lags its share of visits the most. */
export function planAdd(hours: HourInput[], budget: number): number[] {
  const demand = demandShares(hours);
  const deps = hours.map((h) => h.departures);
  for (let step = 0; step < budget; step++) {
    const gaps = shortfalls(demand, deps);
    const target = argBest(gaps, (i) => demand[i] > 0, (a, b) => a > b);
    if (target < 0 || gaps[target] <= 0) break;
    deps[target] += 1;
  }
  return deps.map((d, i) => d - hours[i].departures);
}

/**
 * Cost-neutral rebalance: move up to `moves` departures from the most over-served hour to the most
 * under-served one, never cutting an hour below its capacity-safe floor (see minDepartures).
 */
export function planShift(hours: HourInput[], moves: number): number[] {
  const demand = demandShares(hours);
  const deps = hours.map((h) => h.departures);
  const floors = hours.map(minDepartures);
  const total = sum(deps);
  if (total === 0) return deps.map(() => 0);
  const half = 0.5 / total;
  for (let step = 0; step < moves; step++) {
    const gaps = shortfalls(demand, deps);
    const donor = argBest(gaps, (i) => deps[i] > floors[i], (a, b) => a < b);
    const receiver = argBest(gaps, (i) => demand[i] > 0 && i !== donor, (a, b) => a > b);
    if (donor < 0 || receiver < 0 || gaps[donor] > -half || gaps[receiver] < half) break;
    deps[donor] -= 1;
    deps[receiver] += 1;
  }
  return deps.map((d, i) => d - hours[i].departures);
}
