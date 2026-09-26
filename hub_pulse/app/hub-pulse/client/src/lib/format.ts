export const HUBS = ['UBC', 'Waterfront Station', 'Park Royal Mall'] as const;
export type Hub = (typeof HUBS)[number];

export const DAY_TYPES = [
  { value: 'MF', label: 'Weekdays' },
  { value: 'Sat', label: 'Saturdays' },
  { value: 'Sun/Hol', label: 'Sundays & holidays' },
] as const;
export type DayType = (typeof DAY_TYPES)[number]['value'];

export const dayLabel = (d: DayType) => DAY_TYPES.find((x) => x.value === d)?.label ?? d;

export const pct = (share: number, digits = 0) => `${(Number(share) * 100).toFixed(digits)}%`;

export const compact = (n: number) =>
  new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n));

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const SOURCES =
  'Visits: hackathon device pings, Nov 2025 – Aug 2026 · Service: TransLink GTFS, fall 2026 schedule · Crowding: TransLink TSPR 2025';
