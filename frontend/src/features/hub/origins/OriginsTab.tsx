"use client";

// Origins (spec §9.2, DECISIONS.md "Origins" and "2b answers"): "Where are the people at this hub coming from, and can
// they get home without a transfer?" Basis: the typical mix for the sim's day type and last full hour, or the whole
// dataset. The insight callout, ranked list and map arcs all come from the same mix. Hovering a row highlights its
// arc and bubble, and the reverse (store.hoverOrigin).
import { useEffect, useMemo, useRef } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { RouteBullet } from "@/components/RouteBullet";
import { SourceNote } from "@/components/SourceNote";
import { StaleNote, useStaleness } from "@/components/StaleNote";
import { DefaultSkeleton } from "@/components/StateBoundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Segmented } from "@/components/Segmented";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hubName } from "@/config/hubs";
import { DAY_TYPE_LABELS } from "@/config/scenario";
import { FEED_SOURCE } from "@/data/feed";
import { routeByLineKey, routeById } from "@/data/index";
import { fmtDateShort, fmtIndex, fmtPct, fmtPings, fmtTime, hourLabel } from "@/lib/format";
import { useSimNow } from "@/lib/live/clock";
import { currentOrNextEpisode, useEpisodes } from "@/lib/live/episodes";
import { useSim, type OriginsBasis } from "@/lib/live/store";
import { cn } from "@/lib/utils";
import { surgeDestinations, type OriginMixRow } from "./originMix";
import { ORIGIN_HOURLY_SOURCE, ORIGINS_SOURCE, useOriginMix } from "./useOriginMix";

const MAX_LINE_CHIPS = 4;

export function AccessBadge({ access }: { access: OriginMixRow["access_type"] }) {
  const transfer = access === "TRANSFER_REQUIRED";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <svg width={14} height={8} aria-hidden="true" focusable="false">
        <line
          x1={1}
          x2={13}
          y1={4}
          y2={4}
          strokeLinecap="round"
          strokeWidth={transfer ? 4 : 2}
          className={transfer ? "stroke-access-transfer" : "stroke-access-oneseat"}
        />
      </svg>
      {transfer ? "Transfer required" : "One-seat ride"}
    </span>
  );
}

function LineChips({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, MAX_LINE_CHIPS);
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`Direct lines: ${lines.join(", ")}`}>
      {shown.map((l) => {
        const r = routeByLineKey(l);
        return <RouteBullet key={l} dense route={r ?? { short_name: l, long_name: null, color: null, text_color: null }} />;
      })}
      {lines.length > shown.length && <span className="text-xs text-muted-foreground">+{lines.length - shown.length}</span>}
    </span>
  );
}

function OriginRow({ row, maxShare }: { row: OriginMixRow; maxShare: number }) {
  const hover = useSim((s) => s.hoverOrigin === row.origin);
  const setHover = useSim((s) => s.setHoverOrigin);
  const ref = useRef<HTMLLIElement>(null);
  const share = row.share_of_local_pct ?? 0;
  const transfer = row.access_type === "TRANSFER_REQUIRED";

  // Highlighted from the map: bring the row into view (not when the pointer or focus is already on it).
  useEffect(() => {
    const el = ref.current;
    if (hover && el && !el.matches(":hover") && !el.contains(document.activeElement)) el.scrollIntoView({ block: "nearest" });
  }, [hover]);

  return (
    <li
      ref={ref}
      tabIndex={0}
      aria-label={`${row.origin}: ${fmtPct(share)} of regional pings, ${fmtPings(row.pings)} pings, ${transfer ? "transfer required" : "one-seat ride"}`}
      onMouseEnter={() => setHover(row.origin)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(row.origin)}
      onBlur={() => setHover(null)}
      className={cn("flex flex-col gap-1 rounded-lg px-2 py-2", hover && "bg-accent")}
    >
      <span className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{row.origin}</span>
        <span className="shrink-0">
          {fmtPct(share)} <span className="text-muted-foreground">· {fmtPings(row.pings)}</span>
        </span>
      </span>
      <span className="relative h-2 w-full overflow-hidden rounded-sm bg-muted" aria-hidden>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-sm", transfer ? "bg-access-transfer" : "bg-access-oneseat")}
          style={{ width: `${maxShare > 0 ? (share / maxShare) * 100 : 0}%` }}
        />
      </span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <AccessBadge access={row.access_type} />
        <LineChips lines={row.direct_lines} />
      </span>
    </li>
  );
}

const BASIS_OPTIONS = [
  { value: "typical", label: "Typical hour" },
  { value: "all", label: "Whole dataset" },
] as const;

function BasisToggle() {
  const basis = useSim((s) => s.originsBasis);
  const setBasis = useSim((s) => s.setOriginsBasis);
  return <Segmented<OriginsBasis> value={basis} options={BASIS_OPTIONS} onChange={setBasis} ariaLabel="Origins basis" className="self-start" />;
}

function SurgeDestinations({ hubId }: { hubId: string }) {
  const episodes = useEpisodes();
  const nowMs = useSimNow(1000);
  const episode = Number.isFinite(nowMs) ? currentOrNextEpisode(episodes, hubId, nowMs) : null;
  const peakEvent = useMemo(() => {
    if (!episode) return null;
    return episode.events.reduce((best, e) => ((e.surge_ratio ?? 0) > (best.surge_ratio ?? 0) ? e : best), episode.events[0]);
  }, [episode]);
  const rows = surgeDestinations(peakEvent);
  if (!episode || rows.length === 0) return null;

  return (
    <section aria-labelledby="or-surge" className="flex flex-col gap-2 border-t pt-6">
      <h3 id="or-surge" className="font-heading text-lg leading-tight font-semibold">
        Where the surge crowd is headed
      </h3>
      <p className="text-sm text-muted-foreground">
        Destinations recommended for the {fmtTime(peakEvent!.event_time)} peak ({fmtIndex(peakEvent!.surge_ratio)}), highest
        priority first, with the route to add a bus on.
      </p>
      <ul className="flex flex-col divide-y">
        {rows.map((d) => {
          const route = (d.route_id ? routeById(d.route_id) : undefined) ?? routeByLineKey(d.route);
          return (
            <li key={d.name} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{d.name}</span>
                {!d.matched && <span className="text-xs text-muted-foreground"> (not a mapped origin; no arc)</span>}
              </span>
              <span className="shrink-0">{fmtPct(d.share)}</span>
              <RouteBullet dense route={route ?? { short_name: d.route, long_name: null, color: null, text_color: null }} />
            </li>
          );
        })}
      </ul>
      <SourceNote source={`${FEED_SOURCE} (destination_share, route)`} />
    </section>
  );
}

export function OriginsTab({ hubId }: { hubId: string }) {
  const name = hubName(hubId);
  const result = useOriginMix(hubId);
  const { stale, asOf } = useStaleness();

  if (!result) {
    return (
      <div className="flex flex-col gap-4">
        <BasisToggle />
        <DefaultSkeleton />
      </div>
    );
  }

  const { mix, basis } = result;
  const windowLabel =
    basis === "typical" && result.dayType && result.hour !== null && result.localDate
      ? `Typical ${DAY_TYPE_LABELS[result.dayType].toLowerCase()}, ${hourLabel(result.hour)}–${hourLabel((result.hour + 1) % 24)} (average per day; last full hour is ${fmtDateShort(result.localDate)})`
      : "Whole dataset, Nov 2025 – Aug 2026";
  const source = basis === "typical" ? ORIGIN_HOURLY_SOURCE : ORIGINS_SOURCE;
  const maxShare = Math.max(0, ...mix.regional.map((r) => r.share_of_local_pct ?? 0));
  const regionalWithArcs = mix.regional.filter((r) => r.location);

  return (
    <div className="flex flex-col gap-6">
      {stale && basis === "typical" && <StaleNote asOf={asOf} />}
      <div className="flex flex-col gap-2">
        <BasisToggle />
        <p className="text-sm text-muted-foreground">{windowLabel}</p>
      </div>

      {mix.lowSample && (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>Few pings in this hour.</AlertTitle>
          <AlertDescription>Shares may be noisy ({fmtPings(mix.regionalPings)} regional pings per day on average).</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="or-insight" className="flex flex-col gap-1">
        <p className="flex items-baseline gap-2">
          <span className="font-heading text-4xl font-semibold">{mix.regionalPings > 0 ? `${Math.round(mix.transferSharePct)}%` : "—"}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="self-center text-muted-foreground" aria-label="How this is calculated">
                <Info className="size-4" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Sum of each transfer-required origin&rsquo;s share of regional pings. Regional = one-seat ride + transfer
              required; the hub&rsquo;s own area and out-of-region pings are left out.
            </TooltipContent>
          </Tooltip>
        </p>
        <p id="or-insight" className="text-base leading-snug font-semibold">
          of regional pings at {name} come from areas with no one-seat ride
        </p>
        <SourceNote source={`${source}; access from GTFS lines serving ${name}`} />
      </section>

      <section aria-labelledby="or-list" className="flex flex-col gap-2">
        <h3 id="or-list" className="font-heading text-lg leading-tight font-semibold">
          Regional origins
        </h3>
        <p className="text-sm text-muted-foreground">
          Share of regional pings and pings per day. {regionalWithArcs.length} areas; hover a row to find it on the map.
        </p>
        <ul className="-mx-2 flex flex-col" aria-label="Regional origins, most pings first">
          {mix.regional.map((r) => (
            <OriginRow key={r.origin} row={r} maxShare={maxShare} />
          ))}
        </ul>
      </section>

      {mix.local && (
        <section aria-labelledby="or-local" className="flex flex-col gap-1 border-t pt-6">
          <h3 id="or-local" className="font-heading text-lg leading-tight font-semibold">
            Same area
          </h3>
          <p className="flex items-baseline justify-between text-sm">
            <span className="font-semibold">{mix.local.origin}</span>
            <span>
              {fmtPct(mix.local.share_pct)} of all pings <span className="text-muted-foreground">· {fmtPings(mix.local.pings)}</span>
            </span>
          </p>
        </section>
      )}

      {mix.visitors.length > 0 && (
        <section aria-labelledby="or-visitors" className="flex flex-col gap-1 border-t pt-6">
          <h3 id="or-visitors" className="font-heading text-lg leading-tight font-semibold">
            From outside the region
          </h3>
          <p className="text-sm text-muted-foreground">Share of all pings. No map location, so no arc.</p>
          <ul className="flex flex-col divide-y">
            {mix.visitors.map((v) => (
              <li key={v.origin} className="flex items-baseline justify-between py-1.5 text-sm">
                <span>{v.origin}</span>
                <span>
                  {fmtPct(v.share_pct)} <span className="text-muted-foreground">· {fmtPings(v.pings)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SurgeDestinations hubId={hubId} />
    </div>
  );
}
