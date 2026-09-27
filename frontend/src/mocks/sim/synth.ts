// Deterministic hourly synthesis for mock mode (web/DECISIONS.md "Seed data", spec §12.2).
// Every value is keyed by hub | local_date | hour (plus the issue time for forecasts), never by call order.
//
// - actualPings: real daily total (gold_hub_daily) × the hub/day-type/hour share of the day (real hourly
//   profile) × ±5% seeded noise, so hours sum to the timeline. On the 3 scripted surge days the hours follow
//   the scripted surge-index curve instead: typical × actualIndex[hour] × ±2% noise.
// - typicalPings: the same share × mean real daily pings of the same day type over the 8 weeks before the date.
// - forecastFor: actual × (1 + seeded error growing with lead time); on scripted days, the scripted predicted
//   curve once the surge is detected, and a damped curve before that (PRE_DETECTION_DAMPING).
import type { DayType, HubStatus } from "@/lib/api/schemas";
import { addDays, dayTypeOf, HOUR_MS, startOfVancouverHour, toVancouverIso, vancouverParts, vancouverToMs } from "@/lib/time";
import { dailyByHubDate, hourlyProfile, SEED_HUB_IDS } from "@/mocks/data";
import { gaussian, symmetric } from "./rng";
import { PRE_DETECTION_DAMPING, scenarioFor } from "./scenarioTimeline";
import type { SynthApi } from "./types";

export const SURGE_THRESHOLD = 1.25;
const TRAILING_DAYS = 56;
const ACTUAL_NOISE = 0.05;
const SCRIPTED_NOISE = 0.02;

const round2 = (n: number) => Math.round(n * 100) / 100;

function dayTypeFor(localDate: string): DayType {
  for (const hub of SEED_HUB_IDS) {
    const row = dailyByHubDate(hub, localDate);
    if (row) return row.day_type;
  }
  return dayTypeOf(localDate);
}

function hubDayType(hubId: string, localDate: string): DayType {
  return dailyByHubDate(hubId, localDate)?.day_type ?? dayTypeFor(localDate);
}

// ---------- hourly shares ----------

const shareCache = new Map<string, { shares: number[]; avg: number[] }>();

/** Share of the day's pings in each hour (0-23) and the raw avg_pings, for a hub and day type. */
function profileFor(hubId: string, dayType: DayType): { shares: number[]; avg: number[] } {
  const key = `${hubId}|${dayType}`;
  let hit = shareCache.get(key);
  if (!hit) {
    const avg = new Array<number>(24).fill(0);
    for (const row of hourlyProfile(hubId, dayType)) if (row.hour >= 0 && row.hour < 24) avg[row.hour] = row.avg_pings;
    const total = avg.reduce((a, b) => a + b, 0);
    const shares = avg.map((v) => (total > 0 ? v / total : 1 / 24));
    hit = { shares, avg };
    shareCache.set(key, hit);
  }
  return hit;
}

// ---------- typical ----------

const meanCache = new Map<string, number | null>();

/** Mean real daily pings for the hub's day type over the 8 weeks before localDate; null with fewer than 2 samples. */
function trailingDailyMean(hubId: string, localDate: string, dayType: DayType): number | null {
  const key = `${hubId}|${localDate}|${dayType}`;
  if (meanCache.has(key)) return meanCache.get(key) ?? null;
  let sum = 0;
  let n = 0;
  for (let i = 1; i <= TRAILING_DAYS; i++) {
    const row = dailyByHubDate(hubId, addDays(localDate, -i));
    if (row && row.day_type === dayType) {
      sum += row.pings;
      n += 1;
    }
  }
  const mean = n >= 2 ? sum / n : null;
  meanCache.set(key, mean);
  return mean;
}

function typicalRaw(hubId: string, localDate: string, hour: number): number {
  const dayType = hubDayType(hubId, localDate);
  const { shares, avg } = profileFor(hubId, dayType);
  const mean = trailingDailyMean(hubId, localDate, dayType);
  if (mean === null) return avg[hour] ?? 0;
  return (shares[hour] ?? 0) * mean;
}

function typicalPings(hubId: string, localDate: string, hour: number): number {
  return Math.round(typicalRaw(hubId, localDate, hour));
}

// ---------- actual ----------

function actualRaw(hubId: string, localDate: string, hour: number): number {
  const scenario = scenarioFor(hubId, localDate);
  if (scenario) {
    const idx = scenario.actualIndex[hour] ?? 1;
    return typicalRaw(hubId, localDate, hour) * idx * (1 + SCRIPTED_NOISE * symmetric(`act|${hubId}|${localDate}|${hour}`));
  }
  const noise = 1 + ACTUAL_NOISE * symmetric(`act|${hubId}|${localDate}|${hour}`);
  const daily = dailyByHubDate(hubId, localDate);
  if (!daily) return typicalRaw(hubId, localDate, hour) * noise;
  const { shares } = profileFor(hubId, daily.day_type);
  return daily.pings * (shares[hour] ?? 0) * noise;
}

function actualPings(hubId: string, localDate: string, hour: number): number {
  return Math.max(0, Math.round(actualRaw(hubId, localDate, hour)));
}

// ---------- forecast ----------

function bandFor(forecast: number, leadHours: number) {
  const half = 0.08 + 0.01 * leadHours;
  const f = Math.max(0, Math.round(forecast));
  return {
    forecast: f,
    lower_80: Math.max(0, Math.round(forecast * (1 - half))),
    upper_80: Math.round(forecast * (1 + half)),
  };
}

function forecastFor(hubId: string, issuedMs: number, targetLocalDate: string, targetHour: number) {
  const issued = startOfVancouverHour(issuedMs);
  const targetMs = vancouverToMs(targetLocalDate, targetHour);
  const lead = Math.max(0, Math.round((targetMs - issued) / HOUR_MS));
  const key = `fc|${hubId}|${issued}|${targetLocalDate}|${targetHour}`;

  const scenario = scenarioFor(hubId, targetLocalDate);
  if (scenario) {
    const typical = typicalRaw(hubId, targetLocalDate, targetHour);
    const detectedMs = vancouverToMs(scenario.localDate, scenario.detectedHour);
    if (issued >= detectedMs) {
      const idx = scenario.predictedIndex[targetHour] ?? 1;
      return bandFor(typical * idx * (1 + 0.005 * symmetric(key)), lead);
    }
    const actualIdx = scenario.actualIndex[targetHour] ?? 1;
    const damped = 1 + (actualIdx - 1) * PRE_DETECTION_DAMPING;
    return bandFor(typical * damped * (1 + 0.005 * symmetric(key)), lead);
  }

  const sd = 0.03 + 0.012 * lead;
  const err = sd * gaussian(key);
  return bandFor(actualRaw(hubId, targetLocalDate, targetHour) * (1 + err), lead);
}

// ---------- hub status ----------

function hubStatusAt(
  hubId: string,
  simMs: number,
  extra: Pick<HubStatus, "next_surge" | "active_trip_count" | "pending_proposal_count">,
): HubStatus {
  const hourStart = startOfVancouverHour(simMs);
  const cur = vancouverParts(hourStart);
  const fraction = Math.min(1, Math.max(0, (simMs - hourStart) / HOUR_MS));
  const prev = vancouverParts(hourStart - HOUR_MS);
  const pings = actualPings(hubId, prev.local_date, prev.hour);
  const typical = typicalPings(hubId, prev.local_date, prev.hour);
  const index = typical > 0 ? round2(pings / typical) : 1;
  return {
    hub_id: hubId,
    as_of: toVancouverIso(simMs),
    current_hour: {
      local_date: cur.local_date,
      hour: cur.hour,
      pings_so_far: Math.round(actualPings(hubId, cur.local_date, cur.hour) * fraction),
      typical_pings_so_far: Math.round(typicalPings(hubId, cur.local_date, cur.hour) * fraction),
      complete: false,
    },
    last_full_hour: {
      local_date: prev.local_date,
      hour: prev.hour,
      pings,
      typical_pings: typical,
      surge_index: index,
      is_surge: index >= SURGE_THRESHOLD,
    },
    next_surge: extra.next_surge,
    active_trip_count: extra.active_trip_count,
    pending_proposal_count: extra.pending_proposal_count,
  };
}

export const synth: SynthApi = {
  dayTypeFor,
  actualPings,
  typicalPings,
  forecastFor,
  hubStatusAt,
};
