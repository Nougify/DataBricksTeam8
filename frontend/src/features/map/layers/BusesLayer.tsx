"use client";

// Layer 8: accessible HTML bus markers at the exact live v3 bus locations.
import { Marker } from "react-map-gl/maplibre";
import { useSim } from "@/lib/live/store";
import { DIM_FACTOR } from "../dim";
import { BusSwatch, LegendRow } from "../swatches";
import { busVisual } from "./busPresentation";
import type { MapLayerProps } from "./types";

const BUS_PATH = "M3 4h10.5a2 2 0 0 1 1.5.7L19 10l-4 5.3a2 2 0 0 1-1.5.7H3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z";

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export function BusesLayer({ visible, dimmed, theme }: MapLayerProps) {
  const buses = useSim((s) => s.buses);
  const previewTripId = useSim((s) => s.previewTripId);
  const focusTripId = useSim((s) => s.focusTripId);
  const setFocusTrip = useSim((s) => s.setFocusTrip);
  const setTab = useSim((s) => s.setTab);

  if (!visible) return null;

  return Object.values(buses).map((bus) => {
    const tripId = bus.assigned_trip_id ?? bus.proposed_trip_id;
    const emphasized = tripId !== null && (tripId === previewTripId || tripId === focusTripId);
    const visual = busVisual(bus.status);
    const color = theme.tokens[visual.token];
    const markerOpacity = visual.opacity * (dimmed && tripId !== previewTripId ? DIM_FACTOR : 1);
    const heading = bus.heading_deg ?? 0;
    const label = `Bus ${bus.id}, ${statusLabel(bus.status)}${tripId ? `, linked to trip ${tripId}` : ", unassigned"}`;

    return (
      <Marker
        key={bus.id}
        longitude={bus.location.lon}
        latitude={bus.location.lat}
        anchor="center"
        style={{ zIndex: emphasized ? 5 : 4 }}
      >
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={() => {
            if (!tripId) return;
            setFocusTrip(tripId);
            setTab("trips");
          }}
          className="flex cursor-pointer items-center justify-center rounded-sm transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          style={{ width: visual.size + 8, height: visual.size + 8, opacity: markerOpacity }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            width={visual.size}
            height={visual.size}
            style={{ transform: `rotate(${heading}deg)`, filter: emphasized ? `drop-shadow(0 0 3px ${color})` : undefined }}
          >
            <path d={BUS_PATH} fill="none" stroke={theme.tokens["map-land"]} strokeWidth={4} strokeLinejoin="round" />
            <path
              d={BUS_PATH}
              fill={visual.variant === "solid" ? color : theme.tokens["map-land"]}
              stroke={color}
              strokeWidth={visual.variant === "solid" ? 1 : 2}
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Marker>
    );
  });
}

export function BusesLegend() {
  return (
    <>
      <LegendRow swatch={<BusSwatch variant="solid" fillClass="fill-trip-active" strokeClass="stroke-trip-active" />}>Bus in service</LegendRow>
      <LegendRow swatch={<BusSwatch variant="outline" fillClass="fill-trip-active" strokeClass="stroke-trip-active" />}>Reserved, deadheading or waiting</LegendRow>
      <LegendRow swatch={<BusSwatch variant="solid" fillClass="fill-trip-done" strokeClass="stroke-trip-done" />}>Returning or repositioning</LegendRow>
    </>
  );
}
