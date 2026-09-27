"use client";

// Layer 7: v3 movement plans. The source and every child layer stay mounted so style swaps retain draw order.
import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { ExpressionSpecification } from "maplibre-gl";
import { useSim } from "@/lib/live/store";
import { featureCollection } from "../geo";
import { LegendRow, LineSwatch } from "../swatches";
import { tripPathFeatures } from "./tripPaths";
import type { MapLayerProps } from "./types";

export const TRIP_PATHS_SOURCE = "ov-trip-paths";

const opacity: ExpressionSpecification = ["get", "opacity"];
const width: ExpressionSpecification = ["get", "width"];
const previewColor = (proposed: string, normal: string): ExpressionSpecification => [
  "case",
  ["get", "preview"],
  proposed,
  normal,
];

export function TripPathsLayer({ visible, theme }: MapLayerProps) {
  const trips = useSim((s) => s.trips);
  const buses = useSim((s) => s.buses);
  const previewTripId = useSim((s) => s.previewTripId);
  const focusTripId = useSim((s) => s.focusTripId);
  const data = useMemo(() => {
    const linked = new Set(
      Object.values(buses).flatMap((bus) => [bus.assigned_trip_id, bus.proposed_trip_id].filter((id): id is string => id !== null)),
    );
    return featureCollection(tripPathFeatures(Object.values(trips), previewTripId, focusTripId, linked));
  }, [trips, buses, previewTripId, focusTripId]);

  const layout = useMemo(() => ({ visibility: visible ? ("visible" as const) : ("none" as const) }), [visible]);
  const casingPaint = useMemo(
    () => ({ "line-color": theme.tokens["map-land"], "line-width": ["+", width, 3] as ExpressionSpecification, "line-opacity": opacity }),
    [theme],
  );
  const activePaint = useMemo(
    () => ({ "line-color": previewColor(theme.tokens["trip-proposed"], theme.tokens["trip-active"]), "line-width": width, "line-opacity": opacity }),
    [theme],
  );
  const returnPaint = useMemo(
    () => ({ "line-color": previewColor(theme.tokens["trip-proposed"], theme.tokens["trip-done"]), "line-width": width, "line-opacity": opacity }),
    [theme],
  );
  const deadheadPaint = useMemo(() => ({ ...activePaint, "line-dasharray": [1.5, 1.5] }), [activePaint]);
  const returnDashPaint = useMemo(() => ({ ...returnPaint, "line-dasharray": [0.5, 1.5] }), [returnPaint]);

  return (
    <Source id={TRIP_PATHS_SOURCE} type="geojson" data={data}>
      <Layer id="ov-trip-paths-casing" type="line" layout={layout} paint={casingPaint} />
      <Layer id="ov-trip-paths-deadhead" type="line" filter={["==", ["get", "leg_kind"], "DEADHEAD"]} layout={layout} paint={deadheadPaint} />
      <Layer id="ov-trip-paths-return" type="line" filter={["==", ["get", "leg_kind"], "RETURN"]} layout={layout} paint={returnDashPaint} />
      <Layer id="ov-trip-paths-service" type="line" filter={["==", ["get", "leg_kind"], "SERVICE"]} layout={layout} paint={activePaint} />
    </Source>
  );
}

export function TripPathsLegend() {
  return (
    <>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-trip-active" width={3} dash={[1.5, 1.5]} casing />}>Deadhead movement</LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-trip-active" width={4} casing />}>Additional service</LegendRow>
      <LegendRow swatch={<LineSwatch strokeClass="stroke-trip-done" width={2.5} dash={[0.5, 1.5]} casing />}>Return to source</LegendRow>
    </>
  );
}
