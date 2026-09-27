"use client";

// Layers 3 and 4, origin arcs and bubbles (spec §7.3, DESIGN.md §8.2), plus their HTML labels. Drawn for the
// selected hub from the same mix as the Origins tab (useOriginMix), leaving out LOCAL and VISITOR rows.
//   - Arcs: transfer required = access-transfer with a map-land casing and a 35% → 100% opacity ramp toward the hub;
//     one-seat ride = access-oneseat, 0.7× width, ramp capped at 70%, below the transfer arcs.
//   - Bubbles: radius 3 + 19·√(pings / max), access colour at 25% with a 1.5 px stroke.
//   - Hover (map or list, via store.hoverOrigin): +2 px and full opacity; the others drop to 30%.
//   - Click an arc or bubble: open the Origins tab with that row highlighted.
import { memo, useEffect, useMemo } from "react";
import { Layer, Marker, Source, useMap } from "react-map-gl/maplibre";
import type { ExpressionSpecification, MapLayerMouseEvent } from "maplibre-gl";
import { withAlpha } from "@/components/charts/ibcs";
import { hubConfig } from "@/config/hubs";
import { useOriginMix } from "@/features/hub/origins/useOriginMix";
import type { OriginMixRow } from "@/features/hub/origins/originMix";
import { useSim } from "@/lib/live/store";
import { arcCoordinates, arcWidth, bubbleRadius } from "../arcs";
import { dimFactor, usePreviewHubId } from "../dim";
import { featureCollection } from "../geo";
import { LegendRow, LineSwatch, PointSwatch } from "../swatches";
import type { MapLayerProps } from "./types";
import type { LineString, Point } from "geojson";

type ArcProps = { origin: string; access: string; width: number };
type BubbleProps = { origin: string; access: string; radius: number };

export const ARCS_SOURCE = "ov-origin-arcs";
export const BUBBLES_SOURCE = "ov-origin-bubbles";
const ARC_TRANSFER = "ov-origin-arcs-transfer";
const ARC_ONESEAT = "ov-origin-arcs-oneseat";
const BUBBLES = "ov-origin-bubbles-circle";
const INTERACTIVE = [ARC_TRANSFER, ARC_ONESEAT, BUBBLES];
const LABEL_COUNT = 5;

/** Regional origins with a centroid for the selected hub (null when no hub is selected or the mix isn't ready). */
function useMapOrigins(): { hubId: string; rows: OriginMixRow[] } | null {
  const hubId = useSim((s) => s.selectedHubId);
  const result = useOriginMix(hubId);
  return useMemo(() => {
    if (!hubId || !result) return null;
    return { hubId, rows: result.mix.regional.filter((r) => r.location && r.pings > 0) };
  }, [hubId, result]);
}

const visibility = (on: boolean) => ({ visibility: on ? ("visible" as const) : ("none" as const) });

/** Opacity for one feature: hovered → full; another hovered → 30%; nothing hovered → `base`. */
function hoverOpacity(base: number, hover: string | null, factor: number): number | ExpressionSpecification {
  if (!hover) return base * factor;
  return ["case", ["==", ["get", "origin"], hover], 1 * factor, 0.3 * factor];
}

function hoverWidth(hover: string | null, extra = 2): ExpressionSpecification {
  const w: ExpressionSpecification = ["get", "width"];
  return hover ? ["case", ["==", ["get", "origin"], hover], ["+", w, extra], w] : w;
}

/** Binds hover and click on the origin layers (layer-scoped listeners survive style swaps). */
function useOriginPointer() {
  const { current: mapRef } = useMap();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onMove = (e: MapLayerMouseEvent) => {
      const origin = e.features?.[0]?.properties?.origin;
      if (typeof origin !== "string") return;
      map.getCanvas().style.cursor = "pointer";
      if (useSim.getState().hoverOrigin !== origin) useSim.getState().setHoverOrigin(origin);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      useSim.getState().setHoverOrigin(null);
    };
    const onClick = (e: MapLayerMouseEvent) => {
      const origin = e.features?.[0]?.properties?.origin;
      if (typeof origin !== "string") return;
      const s = useSim.getState();
      s.setTab("origins");
      s.setHoverOrigin(origin);
    };
    map.on("mousemove", INTERACTIVE, onMove);
    map.on("mouseleave", INTERACTIVE, onLeave);
    map.on("click", INTERACTIVE, onClick);
    return () => {
      map.off("mousemove", INTERACTIVE, onMove);
      map.off("mouseleave", INTERACTIVE, onLeave);
      map.off("click", INTERACTIVE, onClick);
    };
  }, [mapRef]);
}

export function OriginArcsLayer({ visible, dimmed, theme }: MapLayerProps) {
  const origins = useMapOrigins();
  const hover = useSim((s) => s.hoverOrigin);
  const previewHubId = usePreviewHubId();
  useOriginPointer();

  const data = useMemo(() => {
    const hub = origins ? hubConfig(origins.hubId) : undefined;
    if (!origins || !hub) return featureCollection<LineString, ArcProps>([]);
    const to = [hub.location.lon, hub.location.lat] as const;
    // One-seat arcs first so transfer arcs draw above them within the same layer order.
    const rows = [...origins.rows].sort((a, b) => Number(a.access_type === "TRANSFER_REQUIRED") - Number(b.access_type === "TRANSFER_REQUIRED"));
    return featureCollection(
      rows.map((r) => {
        const transfer = r.access_type === "TRANSFER_REQUIRED";
        const w = arcWidth(r.share_of_local_pct ?? 0);
        return {
          type: "Feature" as const,
          properties: { origin: r.origin, access: r.access_type, width: transfer ? w : w * 0.7 },
          geometry: { type: "LineString" as const, coordinates: arcCoordinates([r.location!.lon, r.location!.lat], to) },
        };
      }),
    );
  }, [origins]);

  const factor = dimFactor(dimmed, origins?.hubId === previewHubId);
  const on = visible && origins !== null;
  const t = theme.tokens;
  const transfer = t["access-transfer"];
  const oneseat = t["access-oneseat"];

  return (
    <Source id={ARCS_SOURCE} type="geojson" data={data} lineMetrics>
      <Layer
        id={ARC_ONESEAT}
        type="line"
        filter={["==", ["get", "access"], "ONE_SEAT_RIDE"]}
        layout={{ ...visibility(on), "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-width": hoverWidth(hover),
          "line-opacity": hoverOpacity(1, hover, factor),
          "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, withAlpha(oneseat, 0.25), 1, withAlpha(oneseat, 0.7)],
        }}
      />
      <Layer
        id="ov-origin-arcs-transfer-casing"
        type="line"
        filter={["==", ["get", "access"], "TRANSFER_REQUIRED"]}
        layout={{ ...visibility(on), "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-color": t["map-land"],
          "line-width": ["+", hoverWidth(hover), 2],
          "line-opacity": hoverOpacity(0.8, hover, factor),
        }}
      />
      <Layer
        id={ARC_TRANSFER}
        type="line"
        filter={["==", ["get", "access"], "TRANSFER_REQUIRED"]}
        layout={{ ...visibility(on), "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-width": hoverWidth(hover),
          "line-opacity": hoverOpacity(1, hover, factor),
          "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, withAlpha(transfer, 0.35), 1, withAlpha(transfer, 1)],
        }}
      />
    </Source>
  );
}

export function OriginBubblesLayer({ visible, dimmed, theme }: MapLayerProps) {
  const origins = useMapOrigins();
  const hover = useSim((s) => s.hoverOrigin);
  const previewHubId = usePreviewHubId();

  const data = useMemo(() => {
    if (!origins) return featureCollection<Point, BubbleProps>([]);
    const max = Math.max(0, ...origins.rows.map((r) => r.pings));
    return featureCollection(
      origins.rows.map((r) => ({
        type: "Feature" as const,
        properties: { origin: r.origin, access: r.access_type, radius: bubbleRadius(r.pings, max) },
        geometry: { type: "Point" as const, coordinates: [r.location!.lon, r.location!.lat] },
      })),
    );
  }, [origins]);

  const factor = dimFactor(dimmed, origins?.hubId === previewHubId);
  const on = visible && origins !== null;
  const t = theme.tokens;
  const color: ExpressionSpecification = ["case", ["==", ["get", "access"], "TRANSFER_REQUIRED"], t["access-transfer"], t["access-oneseat"]];

  return (
    <Source id={BUBBLES_SOURCE} type="geojson" data={data}>
      <Layer
        id={BUBBLES}
        type="circle"
        layout={visibility(on)}
        paint={{
          "circle-radius": ["get", "radius"],
          "circle-color": color,
          "circle-opacity": hoverOpacity(0.25, hover, factor),
          "circle-stroke-color": color,
          "circle-stroke-width": 1.5,
          "circle-stroke-opacity": hoverOpacity(1, hover, factor),
        }}
      />
    </Source>
  );
}

const OriginLabel = memo(function OriginLabel({ row, faded }: { row: OriginMixRow; faded: boolean }) {
  return (
    <Marker longitude={row.location!.lon} latitude={row.location!.lat} anchor="top" offset={[0, 6]} style={{ pointerEvents: "none" }}>
      <span className={`map-text-halo text-xs font-semibold whitespace-nowrap text-foreground ${faded ? "opacity-30" : ""}`}>
        {row.origin}
      </span>
    </Marker>
  );
});

/** HTML labels: the top 5 origins by pings and the hovered one. */
export function OriginLabels({ visible, dimmed }: MapLayerProps) {
  const origins = useMapOrigins();
  const hover = useSim((s) => s.hoverOrigin);
  if (!visible || !origins) return null;
  const shown = origins.rows.filter((r, i) => i < LABEL_COUNT || r.origin === hover);
  return (
    <>
      {shown.map((r) => (
        <OriginLabel key={r.origin} row={r} faded={dimmed || (hover !== null && hover !== r.origin)} />
      ))}
    </>
  );
}

export function OriginsLegend() {
  const hubSelected = useSim((s) => s.selectedHubId !== null);
  if (!hubSelected) return null;
  return (
    <>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-access-transfer" width={4} casing />}>
        From an area with no one-seat ride (transfer required); width = share
      </LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-access-oneseat" width={2.5} opacity={0.7} />}>
        From an area with a one-seat ride
      </LegendRow>
      <LegendRow swatch={<PointSwatch variant="disc" fillClass="fill-access-transfer/40" strokeClass="stroke-access-transfer" />}>
        Origin area; size = pings
      </LegendRow>
    </>
  );
}
