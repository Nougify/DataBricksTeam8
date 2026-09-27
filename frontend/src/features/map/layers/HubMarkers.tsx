"use client";

// Layer 5, hub markers (spec §7.3, DESIGN §8.2): always-labelled, focusable HTML buttons, each with a halo whose
// radius and opacity follow the last full hour's surge index. The halo ripple is the app's one ambient motion.
//
// Halos render as their own markers *before* the buttons, so every label stays above every halo.
import { memo, useMemo, type CSSProperties } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useSim } from "@/lib/live/store";
import type { HubStatus, Severity, Surge } from "@/lib/api/schemas";
import { fmtIndex, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePageVisible, usePreviewHubId } from "../dim";
import {
  haloFor,
  liveSurgeSeverity,
  useMapHubs,
  useSeverityBands,
  type Halo,
  type HaloTone,
  type MapHub,
} from "../hubs";
import { HaloScaleSwatch, HaloSwatch, LegendRow } from "../swatches";
import type { MapLayerProps } from "./types";

// Static class maps: Tailwind can't see `bg-${tone}`.
const HALO_FILL: Record<HaloTone, string> = {
  typical: "bg-typical",
  low: "bg-surge-low",
  medium: "bg-surge-medium",
  high: "bg-surge-high",
};
const HALO_RING: Record<HaloTone, string> = {
  typical: "border-typical",
  low: "border-surge-low",
  medium: "border-surge-medium",
  high: "border-surge-high",
};

const SEVERITY_WORD: Record<Severity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/** The core sits in a fixed box, so selecting a hub never shifts its label (DESIGN principle 5). */
const CORE_BOX = 26;
const PAD_X = 6;

const HALO_MARKER_STYLE: CSSProperties = { pointerEvents: "none", zIndex: 1 };
const BUTTON_MARKER_STYLE: CSSProperties = { zIndex: 2 };
const SELECTED_MARKER_STYLE: CSSProperties = { zIndex: 3 };

function hubLabel(hub: MapHub, status: HubStatus | undefined, surges: Record<string, Surge>): string {
  const parts = [hub.name];
  const index = status?.last_full_hour.surge_index;
  parts.push(index != null ? `surge index ${fmtIndex(index)} in the last full hour` : "surge index not available yet");
  const next = status?.next_surge;
  const severity = liveSurgeSeverity(status, surges);
  if (next && severity) {
    const active = surges[next.surge_id]?.phase === "ACTIVE";
    parts.push(
      active
        ? `${SEVERITY_WORD[severity]} surge now`
        : `${SEVERITY_WORD[severity]} surge forecast from ${fmtTime(next.window_start)}`,
    );
  }
  return parts.join(", ");
}

const HubHalo = memo(function HubHalo({ halo, faded, animate }: { halo: Halo; faded: boolean; animate: boolean }) {
  const r = halo.radius;
  const ripple = { "--halo-ripple-opacity": halo.ringOpacity } as CSSProperties;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute transition-[left,top,width,height,opacity] duration-500 ease-out"
      style={{ left: -r, top: -r, width: 2 * r, height: 2 * r, opacity: faded ? 0.2 : 1 }}
    >
      <span className={cn("absolute inset-0 rounded-full", HALO_FILL[halo.tone])} style={{ opacity: halo.fillOpacity }} />
      {/* map-land casing under the ring keeps light surge-low readable over water (DESIGN §4.3) */}
      <span className="absolute -inset-px rounded-full border-4 border-map-land" style={{ opacity: halo.ringOpacity * 0.6 }} />
      <span className={cn("absolute inset-0 rounded-full border-2", HALO_RING[halo.tone])} style={{ opacity: halo.ringOpacity }} />
      {animate && (
        <>
          <span className={cn("absolute inset-0 rounded-full border-2 opacity-0 motion-safe:animate-halo", HALO_RING[halo.tone])} style={ripple} />
          <span className={cn("absolute inset-0 rounded-full border-2 opacity-0 motion-safe:animate-halo-late", HALO_RING[halo.tone])} style={ripple} />
        </>
      )}
    </div>
  );
});

const HubButton = memo(function HubButton({
  hub,
  label,
  selected,
  faded,
  onSelect,
}: {
  hub: MapHub;
  label: string;
  selected: boolean;
  faded: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(hub.id)}
      className={cn(
        "absolute flex -translate-y-1/2 cursor-pointer select-none items-center rounded-lg py-[9px] pr-2 transition-opacity duration-200",
        faded && "opacity-20",
      )}
      style={{ left: -(CORE_BOX / 2) - PAD_X, top: 0, paddingLeft: PAD_X }}
    >
      <span className="flex shrink-0 items-center justify-center" style={{ width: CORE_BOX, height: CORE_BOX }}>
        <span
          className={cn(
            "block rounded-full bg-foreground",
            selected ? "size-4 ring-[3px] ring-foreground ring-offset-2 ring-offset-map-land" : "size-3 ring-2 ring-map-land",
          )}
        />
      </span>
      <span className="map-text-halo ml-1 whitespace-nowrap font-heading text-[15px] font-semibold leading-5 text-foreground" style={{ marginTop: hub.id === 'park-royal' ? '-2px' : 0 }}> 
        {hub.name} 
      </span> 
    </button>
  );
});

export function HubMarkers({ dimmed }: MapLayerProps) {
  const hubs = useMapHubs();
  const statuses = useSim((s) => s.hubs);
  const surges = useSim((s) => s.surges);
  const selectedHubId = useSim((s) => s.selectedHubId);
  const selectHub = useSim((s) => s.selectHub);
  const previewHubId = usePreviewHubId();
  const bands = useSeverityBands();
  const pageVisible = usePageVisible();

  const rows = useMemo(
    () =>
      hubs.map((hub) => {
        const status = statuses[hub.id];
        return {
          hub,
          halo: haloFor(status?.last_full_hour.surge_index, liveSurgeSeverity(status, surges), bands),
          label: hubLabel(hub, status, surges),
        };
      }),
    [hubs, statuses, surges, bands],
  );

  const onSelect = useMemo(() => (id: string) => selectHub(id), [selectHub]);

  return (
    <>
      {rows.map(({ hub, halo }) => {
        if (!halo) return null;
        const faded = dimmed && hub.id !== previewHubId;
        return (
          <Marker key={`halo-${hub.id}`} longitude={hub.location.lon} latitude={hub.location.lat} anchor="center" style={HALO_MARKER_STYLE}>
            <HubHalo halo={halo} faded={faded} animate={pageVisible && !faded} />
          </Marker>
        );
      })}
      {rows.map(({ hub, label }) => {
        const selected = hub.id === selectedHubId;
        return (
          <Marker
            key={`hub-${hub.id}`}
            longitude={hub.location.lon}
            latitude={hub.location.lat}
            anchor="center"
            style={selected ? SELECTED_MARKER_STYLE : BUTTON_MARKER_STYLE}
          >
            <HubButton hub={hub} label={label} selected={selected} faded={dimmed && hub.id !== previewHubId} onSelect={onSelect} />
          </Marker>
        );
      })}
    </>
  );
}

export function HubHaloLegend() {
  const bands = useSeverityBands();
  return (
    <>
      <LegendRow swatch={<HaloScaleSwatch />}>
        Hub halo size: surge index in the last full hour, {fmtIndex(1)} to {fmtIndex(bands.HIGH)}
      </LegendRow>
      <LegendRow swatch={<HaloSwatch fillClass="fill-surge-high" strokeClass="stroke-surge-high" />}>
        High surge, {fmtIndex(bands.HIGH)} or more
      </LegendRow>
      <LegendRow swatch={<HaloSwatch fillClass="fill-surge-medium" strokeClass="stroke-surge-medium" />}>
        Medium surge, {fmtIndex(bands.MEDIUM)}–{fmtIndex(bands.HIGH)}
      </LegendRow>
      <LegendRow swatch={<HaloSwatch fillClass="fill-surge-low" strokeClass="stroke-surge-low" />}>
        Low surge, {fmtIndex(bands.LOW)}–{fmtIndex(bands.MEDIUM)}
      </LegendRow>
      <LegendRow swatch={<HaloSwatch fillClass="fill-typical" strokeClass="stroke-typical" />}>
        Above typical, under {fmtIndex(bands.LOW)}
      </LegendRow>
    </>
  );
}
