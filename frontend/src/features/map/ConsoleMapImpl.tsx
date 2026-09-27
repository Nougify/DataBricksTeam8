"use client";

// The console map (spec §7). Client-only: loaded through ConsoleMap (index.ts, next/dynamic with ssr:false).
//
//   - Renders the MapLibre canvas only once next-themes has resolved the theme (useMapTheme), so the wrong
//     style never flashes; until then the container shows the `map-land` colour.
//   - The basemap is probed per theme (basemap.ts); a theme switch or an online → offline fallback swaps
//     `mapStyle`, and every overlay re-attaches because it's a <Source>/<Layer> child (never added imperatively).
//   - Overlays come from layers/registry.ts, drawn in spec §7.3 order (see the ordering note there).
//   - Chrome: layer toggle (top-left), key (bottom-left), attribution (bottom-right).
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Map as MapGL, type ErrorEvent } from "react-map-gl/maplibre";
import { ENV } from "@/config/env";
import { useSim } from "@/lib/live/store";
import { cn } from "@/lib/utils";
import { MapAttribution } from "./attribution";
import { useBasemap, type Basemap } from "./basemap";
import { CameraController } from "./camera";
import { useDimmed } from "./dim";
import { fitPadding, MAX_BOUNDS, METRO_BOUNDS, useRightOcclusion } from "./fit";
import { isModuleOn, MAP_LAYERS } from "./layers/registry";
import { LayerToggle } from "./layerToggle";
import { MapLegend } from "./legend";
import { useMapTheme, type MapTheme } from "./theme";
import { isMapWorkerSettled, prepareMapWorker, subscribeMapWorker } from "./worker";

// Start preparing MapLibre's worker as soon as this (client-only) chunk loads; see worker.ts.
void prepareMapWorker();

export interface ConsoleMapProps {
  /**
   * Pixels of the map covered on the right by the side panel or drawer. Camera fits and the attribution keep
   * clear of it. Default: inferred from layout (420 on desktop / 380 for the tablet drawer, but only when the
   * map reaches the right edge of the viewport).
   */
  insetRight?: number;
  className?: string;
}

const MAP_CSS: CSSProperties = { position: "absolute", inset: 0 };

function MapCanvas({
  theme,
  basemap,
  container,
  occludedRight,
}: {
  theme: MapTheme;
  basemap: Basemap;
  container: HTMLElement;
  occludedRight: number;
}) {
  const layers = useSim((s) => s.layers);
  const dimmed = useDimmed();

  // Read once, when MapLibre is constructed: the network view, clear of the panel and the map controls.
  const [initialViewState] = useState(() => ({
    bounds: METRO_BOUNDS,
    fitBoundsOptions: { padding: fitPadding(container, occludedRight) },
  }));

  // Tile errors repeat by the hundred when offline; log a few in dev instead of flooding the console.
  const errorCount = useRef(0);
  const onError = useCallback((e: ErrorEvent) => {
    if (ENV.isDev && errorCount.current++ < 3) console.warn("Map:", e.error?.message ?? e.error);
  }, []);

  return (
    <MapGL
      mapStyle={basemap.style}
      initialViewState={initialViewState}
      style={MAP_CSS}
      attributionControl={false}
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      maxPitch={0}
      minZoom={8}
      maxZoom={17}
      maxBounds={MAX_BOUNDS}
      renderWorldCopies={false}
      onError={onError}
    >
      {/* GL overlays: all mounted, always, in registry order (layers/registry.ts). */}
      {MAP_LAYERS.map(({ id, toggle, Gl }) =>
        Gl ? <Gl key={id} visible={isModuleOn({ toggle }, layers)} dimmed={dimmed} theme={theme} /> : null,
      )}
      {/* HTML markers sit above the canvas. */}
      {MAP_LAYERS.map(({ id, toggle, Html }) =>
        Html ? <Html key={id} visible={isModuleOn({ toggle }, layers)} dimmed={dimmed} theme={theme} /> : null,
      )}
      <CameraController container={container} occludedRight={occludedRight} />
    </MapGL>
  );
}

export default function ConsoleMapImpl({ insetRight, className }: ConsoleMapProps) {
  const theme = useMapTheme();
  const basemap = useBasemap(theme);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const occludedRight = useRightOcclusion(container, insetRight);
  const workerReady = useSyncExternalStore(subscribeMapWorker, isMapWorkerSettled, () => false);

  return (
    <div
      ref={setContainer}
      className={cn("relative isolate h-full min-h-0 w-full overflow-hidden bg-map-land", className)}
      data-basemap={basemap ? basemap.kind : undefined}
      data-basemap-probing={basemap?.probing ? "" : undefined}
    >
      <LayerToggle />
      {theme && basemap && container && workerReady && (
        <MapCanvas theme={theme} basemap={basemap} container={container} occludedRight={occludedRight} />
      )}
      <MapLegend />
      {basemap && <MapAttribution kind={basemap.kind} probing={basemap.probing} right={occludedRight} />}
    </div>
  );
}
