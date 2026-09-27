"use client";

// Layer 2, hub catchments (spec §7.3, DESIGN §8.2): a 64-point circle of `catchment_m` around each hub.
// Fill `foreground` at 4% (light) / 6% (dark), 1 px outline `foreground` at 25%.
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { ExpressionSpecification } from "maplibre-gl";
import { circlePolygon, featureCollection } from "../geo";
import { DIM_FACTOR, usePreviewHubId } from "../dim";
import { hubLngLat, useMapHubs, type MapHub } from "../hubs";
import { AreaSwatch, LegendRow } from "../swatches";
import type { MapLayerProps } from "./types";

export const CATCHMENTS_SOURCE = "ov-catchments";

function catchmentsGeoJson(hubs: readonly MapHub[]) {
  return featureCollection(
    hubs.map((h) => ({
      type: "Feature" as const,
      id: h.id,
      properties: { hub_id: h.id },
      geometry: circlePolygon(hubLngLat(h), h.catchment_m, 64),
    })),
  );
}

/** `base` for the previewed hub (or everyone outside preview), `base × DIM_FACTOR` for the rest. */
function dimmedOpacity(base: number, dimmed: boolean, previewHubId: string | null): number | ExpressionSpecification {
  if (!dimmed) return base;
  if (!previewHubId) return base * DIM_FACTOR;
  return ["case", ["==", ["get", "hub_id"], previewHubId], base, base * DIM_FACTOR];
}

export function CatchmentsLayer({ visible, dimmed, theme }: MapLayerProps) {
  const hubs = useMapHubs();
  const previewHubId = usePreviewHubId();
  const data = useMemo(() => catchmentsGeoJson(hubs), [hubs]);

  const fg = theme.tokens.foreground;
  const fillBase = theme.name === "dark" ? 0.06 : 0.04;
  const layout = useMemo(() => ({ visibility: visible ? ("visible" as const) : ("none" as const) }), [visible]);
  const fillPaint = useMemo(
    () => ({ "fill-color": fg, "fill-opacity": dimmedOpacity(fillBase, dimmed, previewHubId) }),
    [fg, fillBase, dimmed, previewHubId],
  );
  const linePaint = useMemo(
    () => ({ "line-color": fg, "line-width": 1, "line-opacity": dimmedOpacity(0.25, dimmed, previewHubId) }),
    [fg, dimmed, previewHubId],
  );

  return (
    <Source id={CATCHMENTS_SOURCE} type="geojson" data={data}>
      <Layer id="ov-catchments-fill" type="fill" layout={layout} paint={fillPaint} />
      <Layer id="ov-catchments-line" type="line" layout={layout} paint={linePaint} />
    </Source>
  );
}

export function CatchmentsLegend() {
  return <LegendRow swatch={<AreaSwatch />}>Hub catchment: stops inside it serve the hub</LegendRow>;
}
