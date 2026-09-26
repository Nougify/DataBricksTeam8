import { readFileSync } from 'node:fs';
import { planAdd, planShift, type HourInput } from '/Users/youssefahmed/Downloads/OneDrive_1_2026-09-25/hub_pulse/app/hub-pulse/client/src/lib/planner';
const raw = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Record<string, string>[];
const get = (hub: string, dt: string): HourInput[] => raw.filter((r) => r.hub === hub && r.day_type === dt).map((r) => ({ hour: +r.hour, visits: +r.avg_pings, departures: +r.departures, peakLoad: +r.peak }));
const fmt = (d: number[]) => d.map((v, h) => (v ? `${String(h).padStart(2, '0')}:${v > 0 ? '+' : ''}${v}` : '')).filter(Boolean).join(' ');
console.log('UBC MF add 112:', fmt(planAdd(get('UBC', 'MF'), 112)));
console.log('PR MF shift:', fmt(planShift(get('Park Royal Mall', 'MF'), 1000)));
console.log('WF MF shift:', fmt(planShift(get('Waterfront Station', 'MF'), 1000)));
