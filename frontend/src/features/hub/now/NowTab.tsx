"use client";

// Now (spec §9.1, DECISIONS.md "Now chart" and "2b answers"): "How busy is this hub, how busy will it be, and why?"
//   - arrivals / departures toggle (default arrivals) driving the KPIs and the chart;
//   - KPIs: pings in the last full hour vs typical, surge index vs the 1.25× line, next surge, warning given;
//   - the forecast chart with a 6 / 12 / 24 h window and dispatch-event markers;
//   - driver chips (known exam / holiday events), "Did it happen?" and the scorecard badge.
import { useMemo } from "react";
import { ExternalLink, GraduationCap, PartyPopper } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Kpi, KpiGrid } from "@/components/Kpi";
import { SeverityBadge } from "@/components/SeverityBadge";
import { SourceNote } from "@/components/SourceNote";
import { InlineError } from "@/components/StateBoundary";
import { StaleNote, useStaleness } from "@/components/StaleNote";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/Segmented";
import { hubName } from "@/config/hubs";
import { SURGE_THRESHOLD } from "@/config/scenario";
import { driverEventsBetween, type DriverEvent } from "@/data/events";
import { FEED_SOURCE } from "@/data/feed";
import { FORECAST_SOURCE, forecastHour, type ForecastTarget, type HubForecast } from "@/data/forecast";
import { DEFAULT_LEAD_MINUTES, METRICS_SOURCE, metricsFor } from "@/data/metrics";
import { useHubForecast } from "@/lib/api/hooks";
import { fmtDate, fmtDateShort, fmtDuration, fmtIndex, fmtPct, fmtPings, fmtTime, fmtWindow, hourLabel } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { lastFullHourOf } from "@/lib/live/demand";
import {
  currentOrNextEpisode,
  episodeLeadMinutes,
  episodePhase,
  latestResolvedEpisode,
  useEpisodes,
  type SurgeEpisode,
} from "@/lib/live/episodes";
import { HORIZON_OPTIONS, useSim } from "@/lib/live/store";
import { useSimHourKey } from "@/lib/live/timeKey";
import { useJumpTo } from "@/features/topbar/actions";
import { vancouverParts } from "@/lib/time";
import { buildForecastWindow } from "./forecastWindow";
import { ForecastChart, ForecastLegend, eventMarkers } from "./ForecastChart";

const DAY_MS = 24 * 3_600_000;
const TARGET_WORD: Record<ForecastTarget, string> = { arrivals: "arrivals", departures: "departures" };

function pctVs(a: number, b: number): string {
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
}

const TARGET_OPTIONS = [
  { value: "arrivals", label: "Arrivals" },
  { value: "departures", label: "Departures" },
] as const;

const WINDOW_OPTIONS = HORIZON_OPTIONS.map((h) => ({ value: String(h), label: `±${h} h`, ariaLabel: `${h} hours before and after now` }));

function TargetToggle() {
  const target = useSim((s) => s.forecastTarget);
  const setTarget = useSim((s) => s.setForecastTarget);
  return <Segmented value={target} options={TARGET_OPTIONS} onChange={setTarget} ariaLabel="Pings arriving at or leaving the hub" />;
}

function WindowSelect() {
  const horizon = useSim((s) => s.horizon);
  const setHorizon = useSim((s) => s.setHorizon);
  return (
    <Segmented
      value={String(horizon)}
      options={WINDOW_OPTIONS}
      onChange={(v) => setHorizon(Number(v))}
      ariaLabel="Chart window: hours before and after now"
    />
  );
}

function DriverChip({ event }: { event: DriverEvent }) {
  const Icon = event.category === "EXAM" ? GraduationCap : PartyPopper;
  const dates = event.start_date === event.end_date ? fmtDateShort(event.start_date) : `${fmtDateShort(event.start_date)} – ${fmtDateShort(event.end_date)}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 rounded-full px-2.5 font-normal">
          <Icon aria-hidden className="text-muted-foreground" />
          {event.label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="font-semibold">{event.label}</p>
        <p className="text-muted-foreground">
          {event.category === "EXAM" ? "Exam period" : "BC statutory holiday"}, {dates}
        </p>
        <a
          href={event.source_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-sm underline underline-offset-2"
        >
          {event.source_name}
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </PopoverContent>
    </Popover>
  );
}

function Drivers({ hubId, episode, localDate }: { hubId: string; episode: SurgeEpisode | null; localDate: string }) {
  const from = episode ? vancouverParts(episode.startMs).local_date : localDate;
  const to = episode ? vancouverParts(episode.endMs - 1).local_date : localDate;
  const drivers = driverEventsBetween(hubId, from, to);
  if (drivers.length === 0 && !episode) return null;
  return (
    <section aria-labelledby="now-drivers" className="flex flex-col gap-2">
      <h3 id="now-drivers" className="text-sm font-semibold">
        {episode ? "Known drivers for this surge" : "Known drivers today"}
      </h3>
      {drivers.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {drivers.map((d) => (
            <DriverChip key={d.id} event={d} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No known driver: no exam period or holiday overlaps this surge.</p>
      )}
    </section>
  );
}

function DidItHappen({ forecast, episode, target }: { forecast: HubForecast; episode: SurgeEpisode; target: ForecastTarget }) {
  const peakMs = episode.peakAtMs ?? episode.startMs;
  const p = vancouverParts(peakMs);
  const row = forecastHour(forecast, target, p.local_date, p.hour);
  return (
    <section aria-labelledby="now-did" className="flex flex-col gap-2 rounded-xl border p-4">
      <h3 id="now-did" className="text-base leading-snug font-semibold">
        Did it happen? Predicted {fmtIndex(episode.peakIndex)}, actual {fmtIndex(row?.actual_index)}
      </h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Surge</dt>
        <dd>
          {fmtDateShort(p.local_date)}, {fmtWindow(episode.startMs, episode.endMs)}
        </dd>
        <dt className="text-muted-foreground">Predicted peak</dt>
        <dd>
          {fmtIndex(episode.peakIndex)} at {fmtTime(peakMs)}
        </dd>
        <dt className="text-muted-foreground">Actual, {hourLabel(p.hour)}</dt>
        <dd>
          {fmtIndex(row?.actual_index)} ({fmtPings(row?.actual)} {TARGET_WORD[target]} vs {fmtPings(row?.typical)} typical)
        </dd>
      </dl>
      <SourceNote source={`predicted: ${FEED_SOURCE}; actual: ${FORECAST_SOURCE}`} />
    </section>
  );
}

function ScorecardBadge({ hubId }: { hubId: string }) {
  const setAboutOpen = useSim((s) => s.setAboutOpen);
  const m = metricsFor(DEFAULT_LEAD_MINUTES, hubId);
  if (!m) return null;
  return (
    <div className="flex flex-col gap-1 border-t pt-4">
      <Button variant="outline" size="sm" className="self-start" onClick={() => setAboutOpen(true)}>
        Model at {fmtDuration(DEFAULT_LEAD_MINUTES)} lead: precision {fmtPct(m.precision * 100)}, recall {fmtPct(m.recall * 100)}
      </Button>
      <SourceNote source={`${METRICS_SOURCE}, ${hubName(hubId)}, backtest`} />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-[232px] w-full" />
    </div>
  );
}

export function NowTab({ hubId }: { hubId: string }) {
  const name = hubName(hubId);
  const target = useSim((s) => s.forecastTarget);
  const horizon = useSim((s) => s.horizon);
  const events = useSim((s) => s.events);
  const key = useSimHourKey();
  const nowMs = useSimNow(1000);
  const episodes = useEpisodes();
  const query = useHubForecast(hubId);
  const { stale, asOf } = useStaleness();
  const { jump, isPending } = useJumpTo();
  const forecast = query.data;

  const window = useMemo(
    () => (forecast && key.localDate !== null && key.hour !== null ? buildForecastWindow(forecast, target, key.localDate, key.hour, horizon) : null),
    [forecast, target, key.localDate, key.hour, horizon],
  );
  const hubEvents = useMemo(() => Object.values(events).filter((e) => e.hub_id === hubId), [events, hubId]);
  const markers = useMemo(() => (window ? eventMarkers(hubEvents, window.rows) : new Map()), [hubEvents, window]);

  const last = forecast && key.localDate !== null && key.hour !== null ? lastFullHourOf(forecast, target, key.localDate, key.hour) : null;
  const episode = Number.isFinite(nowMs) ? currentOrNextEpisode(episodes, hubId, nowMs) : null;
  const resolved = Number.isFinite(nowMs) ? latestResolvedEpisode(episodes, hubId, nowMs, DAY_MS) : null;
  const loading = !forecast || key.localDate === null;

  // ---------- KPIs ----------
  const period = last ? `${hourLabel(last.hour)}–${hourLabel((last.hour + 1) % 24)}` : null;
  const row = last?.row ?? null;
  const index = row?.actual_index ?? null;
  const epActive = episode ? episodePhase(episode, nowMs) === "ACTIVE" : false;

  // ---------- chart title (the message) ----------
  let title = "";
  let aria = "";
  if (window && !window.uncovered) {
    const peak = window.peak;
    if (peak && peak.forecast_index !== null && peak.forecast_index >= SURGE_THRESHOLD) {
      title = `${name} forecast to reach ${fmtIndex(peak.forecast_index)} typical at ${hourLabel(peak.hour)}`;
    } else {
      title = `No surge forecast for ${name} in the next ${horizon} h`;
    }
    const nowRow = window.rows[window.nowIndex];
    aria = `${title}. ${TARGET_WORD[target]} pings per hour, ${horizon} hours either side of ${hourLabel(nowRow.hour)}. Last full hour ${fmtPings(row?.actual)} vs ${fmtPings(row?.typical)} typical.${
      markers.size > 0 ? ` ${markers.size} hours with dispatch events.` : ""
    }`;
  }

  return (
    <div className="flex flex-col gap-6">
      {stale && <StaleNote asOf={asOf} />}
      <TargetToggle />

      {query.isError && !forecast ? (
        <InlineError what={`the ${name} forecast`} message={query.error?.message} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <KpiGrid className="max-sm:grid-cols-1 max-sm:[&>*:nth-child(even)]:border-l-0 max-sm:[&>*:nth-child(even)]:pl-0 max-sm:[&>*:nth-child(n+2)]:border-t max-sm:[&>*:nth-child(n+2)]:pt-4 max-sm:[&>*]:pr-0">
          <Kpi
            loading={loading}
            label={`Pings (${TARGET_WORD[target]})`}
            period={period}
            value={fmtPings(row?.actual)}
            unit="pings"
            comparison={
              row?.actual != null && row.typical ? `vs ${fmtPings(row.typical)} typical (${pctVs(row.actual, row.typical)})` : "No hourly data for this hour"
            }
            source={FORECAST_SOURCE}
          />
          <Kpi
            loading={loading}
            label="Surge index"
            period={period}
            value={index === null ? "—" : index.toFixed(2)}
            unit="×"
            comparison={`vs ${fmtIndex(SURGE_THRESHOLD)} surge line`}
            source="computed: actual ÷ typical"
          />
          <Kpi
            label="Next surge"
            period={null}
            value={episode ? (epActive ? "Now" : fmtTime(episode.startMs)) : "None"}
            unit={null}
            badge={episode?.severity ? <SeverityBadge severity={episode.severity} active={epActive} /> : undefined}
            comparison={
              episode
                ? epActive
                  ? `until ${fmtTime(episode.endMs)}, peak ${fmtIndex(episode.peakIndex)}`
                  : `in ${fmtDuration((episode.startMs - nowMs) / 60_000)}, peak ${fmtIndex(episode.peakIndex)}`
                : "No dispatch event forecast yet"
            }
            source={FEED_SOURCE}
          />
          <Kpi
            label="Warning given"
            period={null}
            value={episode ? fmtDuration(episodeLeadMinutes(episode)) : "—"}
            unit={null}
            comparison={episode ? (episode.events[0]?.mode === "PROACTIVE" ? "ahead of the surge (proactive)" : "at the surge (reactive)") : "Shown once a surge is forecast"}
            source={FEED_SOURCE}
          />
        </KpiGrid>
      )}

      <section aria-labelledby="now-chart-title" className="flex flex-col gap-2">
        {loading && !query.isError ? (
          <ChartSkeleton />
        ) : window?.uncovered ? (
          <EmptyState
            title={`No hourly forecast for ${name} at this time`}
            description={`The forecast snapshot starts on Sat Nov 29 2025; the sim is at ${fmtDate(key.at)}.`}
            action={{
              label: "Jump to Nov 29 2025",
              onClick: () => jump("2025-11-29T09:00:00-08:00", { label: "Nov 29 2025" }),
              disabled: isPending,
            }}
          />
        ) : window ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="now-chart-title" className="text-base leading-snug font-semibold">
                  {title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {TARGET_WORD[target] === "arrivals" ? "Pings arriving" : "Pings leaving"} per hour, {horizon} h either side of now
                </p>
              </div>
              <WindowSelect />
            </div>
            <ForecastLegend hasMarkers={markers.size > 0} />
            <ForecastChart window={window} markers={markers} ariaLabel={aria} />
            <SourceNote source={`${FORECAST_SOURCE} (split history); dispatch events: ${FEED_SOURCE}`} />
          </>
        ) : null}
      </section>

      {key.localDate && <Drivers hubId={hubId} episode={episode} localDate={key.localDate} />}
      {forecast && resolved && <DidItHappen forecast={forecast} episode={resolved} target={target} />}
      <ScorecardBadge hubId={hubId} />
    </div>
  );
}
