import { describe, expect, it } from 'vitest';
import { classify, evaluate, minDepartures, planAdd, planShift, type HourInput } from './planner';

const hour = (h: number, visits: number, departures: number, peakLoad = 0): HourInput => ({ hour: h, visits, departures, peakLoad });

// Demand peaks midday (hours 2-3); service peaks at "commute" (hours 0-1). Hour 0 buses are 90% full.
const commuteHeavy: HourInput[] = [hour(0, 10, 40, 90), hour(1, 10, 40, 40), hour(2, 40, 10, 60), hour(3, 40, 10, 60)];

describe('classify', () => {
  it('matches the warehouse status rule', () => {
    expect(classify(0.2, 0.1, 5)).toBe('Underserved');
    expect(classify(0.05, 0.1, 5)).toBe('Overserved');
    expect(classify(0.1, 0.1, 5)).toBe('Balanced');
    expect(classify(0.02, 0, 0)).toBe('No service');
    expect(classify(0.005, 0, 0)).toBe('Balanced');
  });
});

describe('minDepartures', () => {
  it('keeps projected load at or below 85%', () => {
    expect(minDepartures(hour(0, 1, 40, 90))).toBe(40);
    expect(minDepartures(hour(0, 1, 40, 40))).toBe(19);
    expect(minDepartures(hour(0, 1, 40, 0))).toBe(2);
    expect(minDepartures(hour(0, 1, 1, 0))).toBe(1);
  });
});

describe('evaluate', () => {
  it('reports zero mismatch when service mirrors demand', () => {
    const { base } = evaluate([hour(0, 10, 10), hour(1, 30, 30)], [0, 0]);
    expect(base.mismatch).toBeCloseTo(0);
    expect(base.underservedHours).toBe(0);
  });

  it('measures mismatch as the share of departures in the wrong hour', () => {
    const { base } = evaluate(commuteHeavy, [0, 0, 0, 0]);
    expect(base.mismatch).toBeCloseTo(0.6);
    expect(base.underservedHours).toBe(2);
    expect(base.visitsUnderserved).toBeCloseTo(0.8);
    expect(base.overCapacityHours).toBe(1);
  });

  it('projects load onto fewer buses and clamps departures at zero', () => {
    const { rows } = evaluate([hour(0, 1, 10, 50), hour(1, 1, 2)], [-5, -5]);
    expect(rows[0].scenarioLoad).toBeCloseTo(100);
    expect(rows[1].scenarioDepartures).toBe(0);
    expect(rows[1].scenarioLoad).toBeNull();
  });
});

describe('planAdd', () => {
  it('adds exactly the budget to under-served hours and lowers mismatch', () => {
    const deltas = planAdd(commuteHeavy, 40);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(40);
    expect(deltas[0]).toBe(0);
    expect(deltas[1]).toBe(0);
    const { base, scenario } = evaluate(commuteHeavy, deltas);
    expect(scenario.mismatch).toBeLessThan(base.mismatch);
  });

  it('stops early once service already mirrors demand', () => {
    expect(planAdd([hour(0, 10, 10), hour(1, 10, 10)], 5)).toEqual([0, 0]);
  });
});

describe('planShift', () => {
  it('keeps total service constant, respects capacity floors, and lowers mismatch', () => {
    const deltas = planShift(commuteHeavy, 100);
    expect(deltas.reduce((a, b) => a + b, 0)).toBe(0);
    expect(deltas[0]).toBe(0);
    expect(40 + deltas[1]).toBeGreaterThanOrEqual(minDepartures(commuteHeavy[1]));
    const { base, scenario } = evaluate(commuteHeavy, deltas);
    expect(scenario.mismatch).toBeLessThan(base.mismatch);
    expect(scenario.overCapacityHours).toBeLessThanOrEqual(base.overCapacityHours);
  });

  it('does nothing when every over-served hour is at its capacity floor', () => {
    const full = commuteHeavy.map((h) => ({ ...h, peakLoad: h.departures > 20 ? 90 : h.peakLoad }));
    expect(planShift(full, 10)).toEqual([0, 0, 0, 0]);
  });
});
