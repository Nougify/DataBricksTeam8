import { readFileSync } from 'node:fs';
import { evaluate, planAdd, planShift, type HourInput } from '/Users/youssefahmed/Downloads/OneDrive_1_2026-09-25/hub_pulse/app/hub-pulse/client/src/lib/planner';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, string>[];
const groups = new Map<string, HourInput[]>();
for (const r of raw) {
  const k = `${r.hub}|${r.day_type}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k)!.push({ hour: +r.hour, visits: +r.avg_pings, departures: +r.departures, peakLoad: +r.peak });
}
const pct = (x: number) => (x * 100).toFixed(1) + '%';
console.log('hub|day|deps|base_mismatch|base_visits_underserved|base_hours|overcap | shift_moved|shift_mismatch|shift_vu|shift_hours|shift_overcap | add5pct|add_mismatch|add_vu|add_hours');
for (const [k, hours] of groups) {
  const zero = new Array<number>(24).fill(0);
  const b = evaluate(hours, zero).base;
  const sd = planShift(hours, 1000); const s = evaluate(hours, sd).scenario;
  const moved = sd.filter((d) => d > 0).reduce((a, c) => a + c, 0);
  const n = Math.round(b.totalDepartures * 0.05); const a = evaluate(hours, planAdd(hours, n)).scenario;
  console.log([k, b.totalDepartures, pct(b.mismatch), pct(b.visitsUnderserved), b.underservedHours, b.overCapacityHours, moved, pct(s.mismatch), pct(s.visitsUnderserved), s.underservedHours, s.overCapacityHours, n, pct(a.mismatch), pct(a.visitsUnderserved), a.underservedHours].join(' | '));
}
